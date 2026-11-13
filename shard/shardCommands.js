'use strict';

const { PermissionsBitField } = require('discord.js');
const { buildShardMessage } = require('./shardMessage');
const {
  getShardShiftMinutes,
  describeSummerTime,
  applySummerTime,
} = require('../utils/summerTime');

/**
 * 既存index.jsの interactionCreate ハンドラ内、
 * 他の `if (interaction.commandName === '...')` ブロックと並べて
 * 以下のように追加してください:
 *
 *   if (interaction.commandName === 'shard-now') {
 *     return handleShardNowCommand(interaction, data);
 *   }
 *
 *   if (interaction.commandName === 'shard-time' || interaction.commandName === 'summertime') {
 *     return handleShardTimeCommand(interaction, data, saveData);
 *   }
 *
 * data / saveData は既存のinteractionCreateハンドラ冒頭で
 * 取得済みの `loadData()` の戻り値と `saveData` 関数をそのまま渡してください。
 */

/**
 * /shard-now : 今日の破片情報を今すぐ表示する（誰でも使用可）
 */
async function handleShardNowCommand(interaction, data) {
  return interaction.reply({
    content: buildShardMessage(new Date(), getShardShiftMinutes(data)),
  });
}

/**
 * サマータイムの開始・終了を反映して、結果メッセージを作る（/summertime と /shard-time 共通）
 */
function applyAndDescribe(data, saveData, summer) {
  const label = summer ? '開始' : '終了';
  const result = applySummerTime(data, summer);

  if (!result.changed) {
    return `すでに${describeSummerTime(data)}です。変更はありません。`;
  }

  saveData(data);

  let text =
    `サマータイムを${label}しました。\n` +
    `更新時刻: 毎日 ${result.resetHour}:00 JST\n` +
    `（破片・デイリーの通知時刻と、破片セッションの通知・表示時刻をこの設定に合わせます）`;

  if (result.shiftedCount > 0) {
    text += `\n登録済みイベントの日時 ${result.shiftedCount} 件を ${result.fromHour}:00 → ${result.resetHour}:00 に調整しました。`;
  }

  return text;
}

/**
 * /summertime start|end|status : サマータイムの開始・終了・確認
 *   start/end は管理者専用。status は誰でも確認できる。
 * /shard-time mode:<summer|winter> : 従来のコマンド（同じ設定を変更する）
 *   mode省略時は現在の設定を表示する。
 */
async function handleShardTimeCommand(interaction, data, saveData) {
  const isSummerTimeCommand = interaction.commandName === 'summertime';
  let mode = null; // 'summer' | 'winter' | null(=表示のみ)

  if (isSummerTimeCommand) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'start') mode = 'summer';
    if (sub === 'end') mode = 'winter';
  } else {
    mode = interaction.options.getString('mode');
  }

  if (!mode) {
    return interaction.reply({
      content: `現在の設定: ${describeSummerTime(data)}`,
      ephemeral: true,
    });
  }

  if (
    !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)
  ) {
    return interaction.reply({
      content: '管理者専用です。',
      ephemeral: true,
    });
  }

  return interaction.reply({
    content: applyAndDescribe(data, saveData, mode === 'summer'),
  });
}

module.exports = { handleShardNowCommand, handleShardTimeCommand };
