# TOEFL 備戰統一平台

65 天(7/16 → 9/19)托福備考的所有工具整合在一個平台:新制(2026)全題型題庫(可 AI 無限出題)、每日任務、口說錄音三指標、AI 批改、聽寫、拼寫、錯誤本、Flex 配額、模考追蹤。

**兩種形態,同一套程式碼:**

| | 完整版(本機) | 網頁版(GitHub Pages) |
|---|---|---|
| 網址 | http://localhost:5173(`npm run dev`) | https://arthur031221.github.io |
| 資料 | SQLite(`app/data/`) | 瀏覽器 localStorage(設定頁可匯出/匯入) |
| 轉錄 | faster-whisper(準) | Web Speech 即時轉錄(Chrome) |
| AI 批改 | Claude CLI(訂閱零費用)或 API | 自填 Anthropic API key(只存本機瀏覽器) |
| 口說指標 | ffmpeg | 瀏覽器 Web Audio |
| 題庫練習/組織句子/L&R/拼寫/錯誤本 | ✓ | ✓(客觀題完全免金鑰) |
| 65 天計畫/影片追蹤/Flex 配額/模考 | ✓ | —(規劃類工具留在本機) |

網頁版部署:push 到 main 會自動經 GitHub Actions 建置並發佈(`.github/workflows/pages.yml`,`npm run build:static`)。

## 快速開始

需求:**Node.js ≥ 18.18**(建議 20 LTS)。

```bash
cd app
npm install
npm run dev
```

打開瀏覽器 → **http://localhost:5173**(建議 Chrome,錄音與即時轉錄支援最好)。

首次啟動會自動建立資料庫並載入全部種子資料(65 天計畫、66 部影片、Flex 配額、錯誤本、詞庫、題庫)。

---

## Windows(原生)啟動

1. 安裝 [Node.js 20 LTS](https://nodejs.org/)(裝的時候勾選 "Automatically install the necessary tools" 可順帶裝好編譯工具)
2. 安裝 [ffmpeg](https://www.gyan.dev/ffmpeg/builds/):下載 release essentials zip,解壓後把 `bin` 資料夾加入 PATH(或 `winget install ffmpeg`)
3. PowerShell:
   ```powershell
   cd app
   npm install
   npm run dev
   ```
4. (選用,本地轉錄)安裝 [Python 3.10+](https://www.python.org/downloads/) 後:
   ```powershell
   cd app
   python -m venv .venv
   .venv\Scripts\pip install faster-whisper
   ```
5. (Provider A)安裝並登入 [Claude Code CLI](https://claude.com/claude-code):`npm install -g @anthropic-ai/claude-code` → `claude` 登入一次

## WSL2 啟動

```bash
# WSL2 Ubuntu 內
sudo apt update && sudo apt install -y ffmpeg python3-venv   # 若缺
cd app
npm install
python3 -m venv .venv && .venv/bin/pip install faster-whisper   # 選用,本地轉錄
npm run dev
```

Windows 側瀏覽器直接開 http://localhost:5173(WSL2 自動轉發 localhost)。麥克風權限:localhost 是 secure context,Chrome 會直接詢問允許即可。

---

## AI 批改的兩個 Provider(設定頁可切換)

| | Provider A:Claude Code CLI(預設) | Provider B:Anthropic API |
|---|---|---|
| 費用 | 用你的 Claude 訂閱,零額外費用 | 依 token 計費 |
| 需求 | 本機已安裝並登入 `claude` | `.env` 填 `ANTHROPIC_API_KEY` |
| 速度 | 約 30–60 秒/次 | 約 5–15 秒/次 |

Provider B 設定:複製 `.env.example` 為 `.env`,填入金鑰。模型預設 `claude-sonnet-4-6`(設定頁可改)。

## 語音轉文字三層 fallback(口說回饋用)

1. **faster-whisper**(首選,本地、準確):裝在 `app/.venv`,首次轉錄會自動下載模型(base 約 74MB,需網路)
2. **瀏覽器即時轉錄**(Chrome):錄音時勾「即時轉錄」,邊講邊轉
3. **手動貼逐字稿**:都不行時,聽自己的錄音打字

## 常用指令

```bash
npm run dev        # 開發模式(前後端一起起)
npm run typecheck  # 型別檢查
npm run build      # 打包前端(檢查用)
npm start          # 只起後端(搭配已 build 的前端,單埠 http://localhost:3001)
```

埠號:前端 5173、後端 3001。被占用時在 `.env` 設 `WEB_PORT`/`SERVER_PORT`。

## 資料與備份

- 資料庫:`app/data/toefl.sqlite`(SQLite,所有紀錄)
- 錄音:`app/data/recordings/`(檔名 `YYYYMMDD_模式_題號.webm`)
- 上傳素材:`app/data/uploads/`
- **備份**:設定頁 →「匯出全部資料(JSON)」;還原用「匯入」(匯入前會自動備份現有 DB)。錄音檔另外複製資料夾即可。

## 疑難排解

| 症狀 | 解法 |
|---|---|
| `npm run dev` 起來但 AI 批改失敗 | 設定頁 → 連線測試。CLI 不通就確認 `claude` 已登入,或切 Provider B |
| 錄音沒聲音/拿不到麥克風 | 用 Chrome 開 http://localhost:5173(不要用 IP),網址列右側允許麥克風 |
| whisper 轉錄第一次很慢 | 首次下載模型(需網路),之後約 5–10 秒 |
| 口說指標都是 0 | 系統沒 ffmpeg。`ffmpeg -version` 確認,裝好後設定頁「重新偵測」 |
| Vite 啟動報 ENOSPC | Linux inotify 上限;本專案已排除大目錄,若仍發生:`sudo sysctl fs.inotify.max_user_watches=524288` |
| better-sqlite3 安裝失敗 | 確認 Node ≥18.18;Linux 需 `build-essential`,Windows 用 Node 官方安裝器附的 build tools |

## 專案結構

```
app/
├─ server/          # Express 後端(API、AI service、音訊分析、轉錄)
│  ├─ routes/       # 各模組 API
│  └─ whisper_transcribe.py
├─ src/             # React 前端(10 個模組頁面)
├─ seeds/           # 種子資料(65天計畫/影片/配額/錯誤本/詞庫/題庫/模板)
├─ data/            # ← 你的所有資料(gitignore)
└─ .venv/           # ← faster-whisper 隔離環境(選用)
```
