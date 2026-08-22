# 🀅 雀神殿堂 - 麻將戰績記分板與月度 MVP 網站

歡迎使用**雀神殿堂**！這是一個專為打麻將朋友群設計的高顏值、全功能線上戰績記分、月度 MVP 榮譽榜與聽牌大師網站。

---

## 🌟 核心特色功能

1. **🏆 月度 MVP 榮譽榜 & 冠軍頒獎台**
   - 🥇 冠、亞、季軍頒獎台與專屬金冠視覺。
   - 五大特殊月度獎項：**月度雀神 (MVP)**、**勝率之王**、**單將暴發戶**、**大方慈善家**、**雀界勞模**。
   - 完整月度排行榜數據報表（將數、總輸贏、勝率、每將均利、最高單將獨贏）。

2. **👥 牌友池與每一將自由換人**
   - 不限全天只能 4 人，支援彈性替換上桌牌友。
   - 「💡 帶入上一將」一秒填入名單。
   - 內建 **HTML5 Canvas 圓形頭像上傳與裁切工具**。
   - 牌友個人戰績履歷、相剋關係分析（**頭號提款機** / **宿命剋星**）。

3. **⚖️ 零和實時平衡檢查與一鍵自動對平**
   - 快速增減分按鈕 (+100, -100, +500, -500)。
   - 實時計算總合是否達成零和平帳 ($0)。
   - 提供「⚡ 差額一鍵補給此位玩家」快速自動對平。

4. **🧮 底台算分器**
   - 台灣麻將常見加台格式多選快捷鍵（門清、自摸、碰碰胡、清一色、大三元等）。
   - 即時換算放銃 1 人支付與自摸 3 家各付金額。

5. **🧠 聽牌大師 (手牌分析器)**
   - 支援台灣 16/17 張麻將手牌選取。
   - **16 張狀態**：精準計算聽哪幾面牌與胡牌建議。
   - **17 張狀態**：推薦最佳打牌選擇，演算打哪張能達成最多面聽。

6. **💾 資料備份、匯出與一鍵示範數據**
   - 支援 JSON 匯出備份與一鍵還原。
   - 內建「✨ 載入示範數據」快速產生多位玩家與精彩對局。

---

## 🚀 如何在本地開啟？

直接以瀏覽器雙擊開啟 [`index.html`](file:///C:/Users/cheer/.gemini/antigravity/scratch/mahjong-scoreboard/index.html) 即可立即使用！

---

## ☁️ 如何部署至 Vercel？

本專案已完全配置好 Vercel 靜態網站所需的結構與 `vercel.json`。您可以透過以下兩種方式之一發布上線：

### 方法一：透過 GitHub 與 Vercel 網頁介面（最推薦、最簡單）

1. 將本專案資料夾 (`C:\Users\cheer\.gemini\antigravity\scratch\mahjong-scoreboard`) 建立為 GitHub 儲存庫並推送到 GitHub。
2. 登入 [Vercel 官網](https://vercel.com)。
3. 點選 **「Add New...」 ➜ 「Project」**。
4. 選擇您剛剛推送的 GitHub 儲存庫。
5. **Framework Preset** 選擇 **「Other」**（或保留預設），**Root Directory** 保持預設，直接點擊 **「Deploy」**。
6. 約 10 秒內即可獲得專屬的免費線上網址（例如 `https://mahjong-hall.vercel.app`）！

### 方法二：透過 Vercel CLI 指令列一鍵部署

在終端機（PowerShell / Command Prompt）中執行：
```powershell
# 1. 切換至本專案目錄
cd C:\Users\cheer\.gemini\antigravity\scratch\mahjong-scoreboard

# 2. 透過 npx 執行 Vercel 部署指令
npx vercel
```
照著終端機提示登入並按 Enter 確認，即可自動完成上線並取得上線網址！
若要直接部署到正式 Production 環境，可執行：
```powershell
npx vercel --prod
```
