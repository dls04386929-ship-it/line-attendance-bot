const express = require('express');
const line = require('@line/bot-sdk');
const { Pool } = require('pg');

// LINE 設定
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.CHANNEL_SECRET || '6efdf83ede119dc7d80c51461f1fd267'
};

const app = express();
const client = new line.Client(config);

// 連接 PostgreSQL 資料庫
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// 啟動時自動檢查表格與欄位，不會刪除舊資料
pool.query(`
  CREATE TABLE IF NOT EXISTS attendance (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    time VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`).then(async () => {
  // 檢查並新增 display_name 與 location 欄位
  try {
    await pool.query('ALTER TABLE attendance ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);');
    await pool.query('ALTER TABLE attendance ADD COLUMN IF NOT EXISTS location VARCHAR(255);');
    console.log('✅ PostgreSQL 資料表與欄位檢查成功');
  } catch (err) {
    console.error('❌ 新增欄位失敗:', err.message);
  }
}).catch(err => {
  console.error('❌ 建立資料表失敗:', err.message);
});

// 接收 LINE Webhook 請求
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// 事件處理邏輯
async function handleEvent(event) {
  const userId = event.source.userId;
  const now = new Date();
  const timeString = now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });

  // 嘗試向 LINE 取得使用者名稱 (Display Name)
  let displayName = '未知使用者';
  try {
    const profile = await client.getProfile(userId);
    displayName = profile.displayName;
  } catch (err) {
    console.error('取得使用者名稱失敗:', err);
  }

  let replyText = '';

  // 1. 處理使用者傳送「地點/位置」的打卡
  if (event.type === 'message' && event.message.type === 'location') {
    const locationName = event.message.title ? `${event.message.title} (${event.message.address})` : event.message.address;
    const lat = event.message.latitude;
    const lon = event.message.longitude;
    const locationInfo = `${locationName} [${lat}, ${lon}]`;

    // 預設以位置訊息作為上班打卡，或可依需求調整
    await pool.query(
      'INSERT INTO attendance (user_id, display_name, type, time, location) VALUES ($1, $2, $3, $4, $5)',
      [userId, displayName, '定位打卡', timeString, locationInfo]
    );

    replyText = `✅ 【${displayName}】定位打卡成功！\n📍 地點：${locationName}\n⏰ 時間：${timeString}`;
  } 
  // 2. 處理文字訊息打卡
  else if (event.type === 'message' && event.message.type === 'text') {
    const userText = event.message.text.trim();

    if (userText === '上班打卡' || userText === '1') {
      await pool.query(
        'INSERT INTO attendance (user_id, display_name, type, time, location) VALUES ($1, $2, $3, $4, $5)',
        [userId, displayName, '上班', timeString, '未附帶定位']
      );
      replyText = `✅ 【${displayName}】上班打卡成功！\n時間：${timeString}\n\n💡 貼心提醒：您也可以直接傳送 LINE 的「位置資訊」來記錄打卡地點喔！`;
    } else if (userText === '下班打卡' || userText === '2') {
      await pool.query(
        'INSERT INTO attendance (user_id, display_name, type, time, location) VALUES ($1, $2, $3, $4, $5)',
        [userId, displayName, '下班', timeString, '未附帶定位']
      );
      replyText = `✅ 【${displayName}】下班打卡成功！\n時間：${timeString}\n辛苦了！好好休息 🚀`;
    } else {
      replyText = `歡迎使用打卡小幫手！\n請直接回傳以下指令：\n- 輸入「上班打卡」或「1」\n- 輸入「下班打卡」或「2」\n- 或直接傳送您的「位置資訊」進行定位打卡！`;
    }
  } else {
    return Promise.resolve(null);
  }

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: replyText
  });
}

// 提供管理者從資料庫撈取並查看打卡紀錄的網頁畫面
app.get('/admin/records', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM attendance ORDER BY created_at DESC');
    const records = result.rows;

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>員工打卡紀錄資料庫</title>
        <style>
          body { font-family: sans-serif; background: #f4f6f9; margin: 0; padding: 20px; color: #333; }
          .container { max-width: 1000px; margin: 0 auto; background: #fff; padding: 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
          h2 { margin-top: 0; color: #111; }
          .stat { margin-bottom: 16px; font-size: 14px; color: #666; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #eee; font-size: 14px; }
          th { background: #fafafa; font-weight: 600; color: #444; }
          tr:hover { background: #f9f9f9; }
          .badge-up { background: #e3f2fd; color: #1565c0; padding: 4px 8px; border-radius: 4px; font-weight: 500; }
          .badge-down { background: #e8f5e9; color: #2e7d32; padding: 4px 8px; border-radius: 4px; font-weight: 500; }
          .badge-loc { background: #fff3e0; color: #e65100; padding: 4px 8px; border-radius: 4px; font-weight: 500; }
          .empty { text-align: center; color: #999; padding: 30px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>📊 員工打卡紀錄總覽 (含打卡地點)</h2>
          <div class="stat">目前總打卡筆數：<b>${records.length}</b> 筆</div>
          <table>
            <tr>
              <th>序號</th>
              <th>員工名稱 (LINE)</th>
              <th>打卡類型</th>
              <th>打卡地點標示</th>
              <th>打卡時間</th>
            </tr>`;
    
    if(records.length === 0){
      html += `<tr><td colspan="5" class="empty">目前尚無任何打卡紀錄</td></tr>`;
    } else {
      records.forEach((r, index) => {
        let badgeClass = 'badge-up';
        if (r.type === '下班') badgeClass = 'badge-down';
        if (r.type === '定位打卡') badgeClass = 'badge-loc';

        html += `<tr>
          <td>${index + 1}</td>
          <td><b>${r.display_name || '未命名'}</b></td>
          <td><span class="${badgeClass}">${r.type}</span></td>
          <td>${r.location || '無地點資訊'}</td>
          <td>${r.time}</td>
        </tr>`;
      });
    }
    
    html += `</table></div></body></html>`;
    res.send(html);
  } catch (err) {
    res.status(500).send('讀取資料庫失敗：' + err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
