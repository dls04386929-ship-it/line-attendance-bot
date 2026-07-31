const express = require('express');
const line = require('@line/bot-sdk');

// 填入您剛取得的 Channel Secret 與 Channel Access Token
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN || '您稍後要填入的Access Token',
  channelSecret: process.env.CHANNEL_SECRET || '6efdf83ede119dc7d80c51461f1fd267'
};

const app = express();
const client = new line.Client(config);

// 記憶體中的簡單打卡紀錄儲存 (正式上線建議接資料庫)
const attendanceRecords = [];

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
  if (event.type !== 'message' || event.type === 'message' && event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userText = event.message.text.trim();
  const userId = event.source.userId;
  const now = new Date();
  const timeString = now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });

  let replyText = '';

  if (userText === '上班打卡' || userText === '1') {
    attendanceRecords.push({ userId, type: '上班', time: timeString });
    replyText = `✅ 上班打卡成功！\n時間：${timeString}`;
  } else if (userText === '下班打卡' || userText === '2') {
    attendanceRecords.push({ userId, type: '下班', time: timeString });
    replyText = `✅ 下班打卡成功！\n時間：${timeString}\n辛苦了！好好休息 🚀`;
  } else {
    replyText = `歡迎使用打卡小幫手！\n請直接回傳以下指令：\n- 輸入「上班打卡」或「1」\n- 輸入「下班打卡」或「2」`;
  }

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: replyText
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});