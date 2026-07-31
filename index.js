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

// 啟動時自動建立打卡紀錄資料表（支援儲存 display_name）
pool.query(`
  CREATE TABLE IF NOT EXISTS attendance (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    type VARCHAR(50) NOT NULL,
    time VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`).then(() => {
  console.log('✅ PostgreSQL 資料表檢查/建立成功');
}).catch(err => {
  console.error('❌ 建立資料表失敗:', err);
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
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userText = event.message.text.trim();
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

  if (userText === '上班打卡' || userText === '1') {
    // 寫入 PostgreSQL 資料庫 (包含名字)
    await pool.query(
      'INSERT INTO attendance (user_id, display_name, type, time) VALUES ($1, $2, $3, $4)',
      [userId, displayName, '上班', timeString]
    );
    replyText = `✅ 【${displayName}】上班打卡成功！\n時間：${timeString}`;
  } else if (userText === '下班打卡' || userText === '2') {
    // 寫入 PostgreSQL 資料庫 (包含名字)
    await pool.query(
      'INSERT INTO attendance (user_id, display_name, type, time) VALUES ($1, $2, $3, $4)',
      [userId, displayName, '下班', timeString]
    );
    replyText = `✅ 【${displayName}】下班打卡成功！\n時間：${timeString}\n辛苦了！好好休息 🚀`;
  } else {
    replyText = `歡迎使用打卡小幫手！\n請直接回傳以下指令：\n- 輸入「上班打卡」或「1」\n- 輸入「下班打卡」或「2」`;
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
          .container { max-width: 900px; margin: 0 auto; background: #fff; padding: 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
          h2 { margin-top: 0; color: #111; }
          .stat { margin-bottom: 16px; font-size: 14px; color: #666; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #eee; font-size: 14px; }
          th { background: #fafafa; font-weight: 600; color: #444; }
          tr:hover { background: #f9f9f9; }
          .badge-up { background: #e3f2fd; color: #1565c0; padding: 4px 8px; border-radius: 4px; font-weight: 500; }
          .badge-down { background: #e8f5e9; color: #2e7d32; padding: 4px 8px; border-radius: 4px; font-weight: 500; }
          .empty { text-align: center; color: #999; padding: 30px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>📊 員工打卡紀錄總覽</h2>
          <div class="stat">目前總打卡筆數：<b>${records.length}</b> 筆</div>
          <table>
            <tr>
              <th>序號</th>
              <th>員工名稱 (LINE)</th>
              <th>LINE User ID</th>
              <th>打卡類型</th>
              <th>打卡時間</th>
            </tr>`;
    
    if(records.length === 0){
      html += `<tr><td colspan="5" class="empty">目前尚無任何打卡紀錄</td></tr>`;
    } else {
      records.forEach((r, index) => {
        const badgeClass = r.type === '上班' ? 'badge-up' : 'badge-down';
        html += `<tr>
          <td>${index + 1}</td>
          <td><b>${r.display_name || '未命名'}</b></td>
          <td style="font-family: monospace; color: #777; font-size: 12px;">${r.user_id}</td>
          <td><span class="${badgeClass}">${r.type}</span></td>
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
