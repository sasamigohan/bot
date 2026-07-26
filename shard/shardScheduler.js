'use strict';

/**
 * 破片通知スケジューラ（既存Botの setInterval + JST毎分ポーリング方式に統一）
 *
 * 既存の handleDailyReminder 等と同じ流儀:
 *   - client.once('clientReady', ...) 内で setInterval(() => handleShardSchedule(...), 60 * 1000) を登録
 *   - 毎分呼ばれるたびにJST時刻を見て、送信すべきタイミングかどうかを判定
 *   - 送信済みかどうかは dataManager の data.shardData に記録して重複送信を防ぐ
 *
 * 送信するメッセージは3種類:
 *   1. 毎日定時（16:00 or 17:00、コマンドで切替可能）の「本日の破片」まとめ
 *   2. 各セッション開始時刻ちょうどの「セッション開始」通知（1日最大3回）
 *   3. 各セッション終了時刻ちょうどの「セッション終了」通知（1日最大3回）
 */

const { getShardSessions } = require('./shardCalculator');
const {
  buildShardMessage,
  buildSessionStartMessage,
  buildSessionEndMessage,
} = require('./shardMessage');

const SHARD_CHANNEL_ID = '1530865975455649902';

// sentSessionKeysに溜め続けると肥大化するため、この日数より古いキーは間引く
const SESSION_KEY_RETENTION_DAYS = 3;

/**
 * index.js側の getJstDateString / getJstHourMinute と同じロジック。
 * dataManager等、他のモジュールと計算がズレないよう、ここでも同一の実装を持つ。
 */
function getJstDateString(date = new Date()) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function getJstHourMinute(date = new Date()) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    hour: jst.getUTCHours(),
    minute: jst.getUTCMinutes(),
  };
}

/**
 * JST基準の「今日の0時」に相当するDateを、ローカルDateオブジェクトとして返す
 * （getShardInfo/getShardSessionsに渡す基準日として使う。
 *   これらの関数はDateのgetFullYear/getMonth/getDate/getDayをローカルタイムとして読むため、
 *   ここで作るDateも「年月日だけ正しければよい」単純なローカルDateでよい）
 */
function getJstTodayAsDate(date = new Date()) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return new Date(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
}

/**
 * @param {import('discord.js').Client} client
 * @param {string} content
 */
async function sendToShardChannel(client, content) {
  try {
    const channel = await client.channels.fetch(SHARD_CHANNEL_ID);
    if (!channel) {
      console.error('[shardScheduler] チャンネルが見つかりません:', SHARD_CHANNEL_ID);
      return;
    }
    await channel.send(content);
  } catch (err) {
    console.error('[shardScheduler] 送信エラー:', err);
  }
}

/**
 * sentSessionKeysから、指定日数より古い日付のキーを取り除く。
 * キーの形式は "YYYY-MM-DD:idx:start" または "YYYY-MM-DD:idx:end"。
 */
function pruneOldSessionKeys(shardData, todayStr) {
  const todayMs = new Date(todayStr).getTime();
  const cutoffMs = todayMs - SESSION_KEY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  shardData.sentSessionKeys = shardData.sentSessionKeys.filter((key) => {
    const datePart = key.split(':')[0];
    const ms = new Date(datePart).getTime();
    return !Number.isNaN(ms) && ms >= cutoffMs;
  });
}

/**
 * 毎分呼び出されるメインの判定・送信処理。
 * 既存の handleDailyReminder 等と呼び出しパターンを揃えるため、
 * client / loadData / saveData を引数で受け取る形にしてある
 * （index.js側で `() => handleShardSchedule(client, loadData, saveData)` として setInterval に渡す）。
 *
 * @param {import('discord.js').Client} client
 * @param {() => any} loadData dataManagerのloadData
 * @param {(data: any) => void} saveData dataManagerのsaveData
 */
async function handleShardSchedule(client, loadData, saveData) {
  const data = loadData();
  if (!data.shardData) {
    data.shardData = { isSummerTime: true, lastDailySentDate: null, sentSessionKeys: [] };
  }

  const { hour, minute } = getJstHourMinute();
  const todayStr = getJstDateString();
  const todayDate = getJstTodayAsDate();

  let changed = false;

  // ---- 1. 毎日定時の「本日の破片」まとめ ----
  const dailyHour = data.shardData.isSummerTime ? 16 : 17;
  if (hour === dailyHour && minute === 0 && data.shardData.lastDailySentDate !== todayStr) {
    await sendToShardChannel(client, buildShardMessage(todayDate));
    data.shardData.lastDailySentDate = todayStr;
    changed = true;
  }

  // ---- 2. & 3. セッション開始・終了通知 ----
  // 「今日」と「昨日」の両方のセッション定義を見る必要がある。
  // なぜなら、日をまたいで開始・終了するセッション（例: 翌日04:28開始/終了など）は
  // 「基準日=前日」のセッションとして計算されているため、
  // 今日の時刻と一致するかを見るには前日基準のセッションもチェックする必要がある。
  for (const offsetDays of [-1, 0]) {
    const baseDate = new Date(
      todayDate.getFullYear(),
      todayDate.getMonth(),
      todayDate.getDate() + offsetDays
    );
    const baseDateStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
    const sessions = getShardSessions(baseDate);
    if (!sessions) continue;

    for (const session of sessions) {
      // 開始判定
      const startDate = new Date(
        baseDate.getFullYear(),
        baseDate.getMonth(),
        baseDate.getDate() + session.startDaysOffset
      );
      const startDateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
      const [startH, startM] = session.startTimeStr.split(':').map(Number);

      if (startDateStr === todayStr && hour === startH && minute === startM) {
        const key = `${baseDateStr}:${session.index}:start`;
        if (!data.shardData.sentSessionKeys.includes(key)) {
          const msg = buildSessionStartMessage(baseDate, session.index);
          if (msg) await sendToShardChannel(client, msg);
          data.shardData.sentSessionKeys.push(key);
          changed = true;
        }
      }

      // 終了判定
      const endDate = new Date(
        baseDate.getFullYear(),
        baseDate.getMonth(),
        baseDate.getDate() + session.endDaysOffset
      );
      const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
      const [endH, endM] = session.endTimeStr.split(':').map(Number);

      if (endDateStr === todayStr && hour === endH && minute === endM) {
        const key = `${baseDateStr}:${session.index}:end`;
        if (!data.shardData.sentSessionKeys.includes(key)) {
          const msg = buildSessionEndMessage(baseDate, session.index);
          if (msg) await sendToShardChannel(client, msg);
          data.shardData.sentSessionKeys.push(key);
          changed = true;
        }
      }
    }
  }

  if (changed) {
    pruneOldSessionKeys(data.shardData, todayStr);
    saveData(data);
  }
}

module.exports = {
  handleShardSchedule,
  SHARD_CHANNEL_ID,
};
