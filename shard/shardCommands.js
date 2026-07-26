'use strict';

const { PermissionsBitField } = require('discord.js');
const { buildShardMessage } = require('./shardMessage');

/**
 * 既存index.jsの interactionCreate ハンドラ内、
 * 他の `if (interaction.commandName === '...')` ブロックと並べて
 * 以下のように追加してください:
 *
 *   if (interaction.commandName === 'shard-now') {
 *     return handleShardNowCommand(interaction);
 *   }
 *
 *   if (interaction.commandName === 'shard-time') {
 *     return handleShardTimeCommand(interaction, data, saveData);
 *   }
 *
 * data / saveData は既存のinteractionCreateハンドラ冒頭で
 * 取得済みの `loadData()` の戻り値と `saveData` 関数をそのまま渡してください。
 */

/**
 * /shard-now : 今日の破片情報を今すぐ表示する（誰でも使用可）
 */
async function handleShardNowCommand(interaction) {
  return interaction.reply({
    content: buildShardMessage(new Date()),
  });
}

/**
 * /shard-time mode:<summer|winter> : サマータイム設定を切り替える（管理者専用）
 * mode省略時は現在の設定を表示する。
 */
async function handleShardTimeCommand(interaction, data, saveData) {
  const mode = interaction.options.getString('mode');

  if (!data.shardData) {
    data.shardData = { isSummerTime: true, lastDailySentDate: null, sentSessionKeys: [] };
  }

  if (!mode) {
    return interaction.reply({
      content: `現在の設定: ${data.shardData.isSummerTime ? 'サマータイム中（毎日16:00に送信）' : 'サマータイム終了後（毎日17:00に送信）'}`,
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

  data.shardData.isSummerTime = mode === 'summer';
  saveData(data);

  return interaction.reply({
    content:
      mode === 'summer'
        ? 'サマータイム設定をONにしました（毎日16:00に送信します）'
        : 'サマータイム設定をOFFにしました（毎日17:00に送信します）',
  });
}

module.exports = { handleShardNowCommand, handleShardTimeCommand };
