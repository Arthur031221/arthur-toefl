import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderState = 'idle' | 'countdown' | 'recording' | 'stopped';

/** MediaRecorder 錄音 hook:支援開始倒數與自動停止 */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onStopRef = useRef<((blob: Blob, lead: number) => void) | null>(null);
  const maxSecondsRef = useRef(0);
  const leadRef = useRef(0);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') {
      mediaRef.current.stop();
    }
  }, []);

  /**
   * countdownSec 秒倒數後開錄,maxSeconds 到自動停,結束呼叫 onStop(blob, lead)。
   * 防切頭:錄音器會「提前偷跑」——倒數剩 1 秒(或無倒數時點擊當下)就開始收音,
   * 正式開始(GO)前多錄的秒數 = lead,由後端在指標計算時扣除。
   * 這樣就算你在倒數結束瞬間開口、或裝置需要暖機,第一個字也完整在檔案裡。
   */
  const start = useCallback(
    async (options: {
      countdownSec?: number;
      maxSeconds?: number;
      onStop: (blob: Blob, lead: number) => void;
    }) => {
      setError('');
      chunksRef.current = [];
      onStopRef.current = options.onStop;
      maxSecondsRef.current = options.maxSeconds ?? 0;

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // 關閉自動增益:AGC 開頭的音量爬升會讓前幾個字很小聲
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        });
      } catch {
        setError('無法取得麥克風權限。請允許瀏覽器使用麥克風(localhost 應可直接使用)。');
        return;
      }
      streamRef.current = stream;

      let mrStartAt = 0;
      /** 開始收音(不動 UI 狀態) */
      const arm = () => {
        if (mediaRef.current && mediaRef.current.state !== 'inactive') return;
        const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) =>
          MediaRecorder.isTypeSupported(m)
        );
        const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        mediaRef.current = mr;
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        mr.onstop = () => {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          stream.getTracks().forEach((t) => t.stop());
          setState('stopped');
          const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
          onStopRef.current?.(blob, leadRef.current);
        };
        mr.start(250);
        mrStartAt = Date.now();
      };

      /** 正式開始:切 UI、計時、記下 lead */
      const go = () => {
        arm(); // 保險:若還沒偷跑就現在開始
        leadRef.current = Math.round(((Date.now() - mrStartAt) / 1000) * 10) / 10;
        setState('recording');
        setElapsed(0);
        const goAt = Date.now();
        timerRef.current = setInterval(() => {
          const sec = (Date.now() - goAt) / 1000;
          setElapsed(sec);
          if (maxSecondsRef.current > 0 && sec >= maxSecondsRef.current) {
            stop();
          }
        }, 100);
      };

      const cd = options.countdownSec ?? 0;
      if (cd > 0) {
        setState('countdown');
        setCountdown(cd);
        let left = cd;
        if (left <= 1) arm(); // 倒數只有 1 秒也要偷跑
        const t = setInterval(() => {
          left -= 1;
          setCountdown(left);
          if (left === 1) arm(); // 倒數剩 1 秒:錄音器提前偷跑
          if (left <= 0) {
            clearInterval(t);
            go();
          }
        }, 1000);
      } else {
        // 無倒數(跟讀/複誦):點擊當下立刻收音,不會吃字
        arm();
        go();
      }
    },
    [stop]
  );

  return { state, elapsed, countdown, error, start, stop, setState };
}

/* ---- Web Speech API(瀏覽器即時轉錄,第 2 層 fallback) ---- */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

export function webSpeechSupported(): boolean {
  const w = window as unknown as Record<string, unknown>;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function useWebSpeech() {
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef('');
  const [live, setLive] = useState('');
  const activeRef = useRef(false);

  const start = useCallback(() => {
    const w = window as unknown as Record<string, new () => SpeechRecognitionLike>;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return false;
    finalRef.current = '';
    setLive('');
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      setLive((finalRef.current + interim).trim());
    };
    rec.onend = () => {
      // 連續模式中途斷線就重啟(錄音期間)
      if (activeRef.current) {
        try {
          rec.start();
        } catch {
          /* 忽略 */
        }
      }
    };
    rec.onerror = () => {};
    activeRef.current = true;
    try {
      rec.start();
    } catch {
      return false;
    }
    recRef.current = rec;
    return true;
  }, []);

  const stop = useCallback((): string => {
    activeRef.current = false;
    try {
      recRef.current?.stop();
    } catch {
      /* 忽略 */
    }
    return finalRef.current.trim();
  }, []);

  return { start, stop, live };
}
