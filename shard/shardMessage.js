'use strict';

const { getShardInfo } = require('./shardCalculator');

/**
 * 「今日の破片」メッセージ文字列を生成する。
 * @param {Date} date
 * @returns {string}
 */
function buildShardMessage(date = new Date()) {
  const info = getShardInfo(date);

  if (info.type === 'なし') {
    return '【本日の破片】\n本日は破片イベントはありません';
  }

  const timesText = info.times.join(' / ');

  return (
    `【本日の破片】\n` +
    `${info.type}の破片\n` +
    `場所: ${info.region} ${info.place}\n` +
    `報酬: ${info.reward}\n` +
    `時間: ${timesText}`
  );
}

/**
 * セッション開始メッセージを生成する。
 * @param {Date} date その日（開始日basis）
 * @param {number} sessionIndex 何回目のセッションか(0-2)
 * @returns {string|null} 「なし」の日はnull
 */
function buildSessionStartMessage(date, sessionIndex) {
  const info = getShardInfo(date);
  if (info.type === 'なし') return null;

  return (
    `🌠 破片セッション開始！\n` +
    `${info.type}の破片｜${info.region} ${info.place}\n` +
    `報酬: ${info.reward}`
  );
}

/**
 * セッション終了メッセージを生成する。
 * @param {Date} date その日（開始日basis。終了日ではない点に注意）
 * @param {number} sessionIndex 何回目のセッションか(0-2)
 * @returns {string|null} 「なし」の日はnull
 */
function buildSessionEndMessage(date, sessionIndex) {
  const info = getShardInfo(date);
  if (info.type === 'なし') return null;

  return (
    `✨ 破片セッション終了\n` +
    `${info.type}の破片｜${info.region} ${info.place}`
  );
}

module.exports = { buildShardMessage, buildSessionStartMessage, buildSessionEndMessage };
