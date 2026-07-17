export interface TaskItem {
  key: string;
  kind: 'check' | 'video';
  label: string;
  sub: string;
  minutes: number | null;
  module: string;
  done: boolean;
  code?: string;
}

export interface DayStat {
  total: number;
  done: number;
  complete: boolean;
}

export interface PlanDay {
  date: string;
  dow: string;
  phase: string;
  type: string;
  typeLabel: string;
  videos: string[];
  main: string;
  special: string;
  missed: number;
  items?: TaskItem[];
  stat: DayStat;
  carryoverIn?: number;
  isPast?: boolean;
  isToday?: boolean;
}

export interface Carryover {
  id: number;
  from_date: string;
  to_date: string;
  content: string;
  done: number;
}

export interface MockExam {
  id: number;
  date: string;
  label: string;
  r: number | null;
  l: number | null;
  w: number | null;
  s: number | null;
  self_ws: number;
  note: string;
}

export interface DashboardData {
  today: string;
  examDate: string;
  daysLeft: number;
  planStart: string;
  planEnd: string;
  streak: number;
  day: (PlanDay & { items: TaskItem[] }) | null;
  carryover: Carryover[];
  latestMock: MockExam | null;
  targets: Record<string, { from: number; to: number }>;
}

export interface VideoRow {
  code: string;
  course: string;
  title: string;
  dur: string;
  speed: string;
  done_target: string;
  scheduled_date: string;
  note: string;
  tips: string;
  done: number;
  done_at: string;
}

export interface CourseProgress {
  course: string;
  total: number;
  done: number;
  done_target: string;
  speed: string;
}

export interface QuotaItem {
  item: string;
  total: number;
  used: number;
  reserve: number;
  rule: string;
  planned: string[];
  nextPlanned: string;
  remaining: number;
  lowWarning: boolean;
}

export interface SystemStatus {
  ffmpeg: boolean;
  ffmpegVersion: string;
  whisper: 'venv' | 'system' | 'none';
  whisperPython: string;
  claudeCli: boolean;
  claudeCliVersion: string;
  apiKey: boolean;
  provider: string;
  checkedAt: string;
}

export interface ErrorEntry {
  id: number;
  cat: string;
  wrong: string;
  correct: string;
  note: string;
  source: string;
  repeat_count: number;
  created_at: string;
}

export interface AiError {
  category: string;
  wrong: string;
  correct: string;
  note: string;
}

export interface GradeResult {
  score?: number;
  score100?: number;
  task_check?: { task: string; done: boolean }[];
  word_count?: number;
  errors?: AiError[];
  improved_version?: string;
  comment?: string;
}

export interface SpeakingFeedback {
  score100?: number;
  errors?: AiError[];
  natural_version?: string;
  are_advice?: string;
  sentence_completion?: string;
  comment?: string;
}

export interface WritingSession {
  id: number;
  kind: string;
  prompt_id: number | null;
  prompt_text: string;
  answer: string;
  seconds_used: number;
  overtime: number;
  word_count: number;
  score: number | null;
  score100: number | null;
  feedback: string;
  used_flex: number;
  status: string;
  date: string;
  created_at: string;
}

export interface WritingPrompt {
  id: number;
  kind: string;
  title: string;
  prompt: string;
  source: string;
}

export interface SpellingWord {
  id: number;
  word: string;
  grp: string;
  hint: string;
  correct_streak: number;
  wrong_count: number;
  retry_left: number;
  last_seen: string;
}

export interface SpeakingSession {
  id: number;
  mode: string;
  question: string;
  audio_path: string;
  duration: number;
  dead_air_count: number;
  voiced_seconds: number;
  silence_json: string;
  transcript: string;
  transcript_source: string;
  feedback: string;
  score100: number | null;
  is_baseline: number;
  group_id: string;
  date: string;
  created_at: string;
}

export interface RepeatMaterial {
  id: number;
  title: string;
  kind: string; // audio | tts
  audio_path: string;
  youtube_url: string;
  transcript: string;
  created_at: string;
}

export interface DictationMaterial {
  id: number;
  title: string;
  kind: string;
  audio_path: string;
  transcript: string;
  source_note: string;
  created_at: string;
}
