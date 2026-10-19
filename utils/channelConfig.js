const settings = require('../config/settings');
const { loadData } = require('./dataManager');

/**
 * 通知チャンネルの一覧。
 * /notify-channel で上書きされるまでは fallback（これまでの固定ID）が使われる。
 * 設定値は data.notifyChannels に保存される（DBに入るのでBot再起動後も残る）。
 */
const NOTIFY_CHANNELS = {
    daily_reminder: {
        label: 'デイリーリマインダー',
        fallback: () => settings.DAILY_REMINDER_CHANNEL_ID
    },
    level_announce: {
        label: 'レベルアップ通知',
        fallback: () => settings.LEVEL_ANNOUNCE_CHANNEL_ID,
        // 空のときは、ポイントを獲得した発言のチャンネルに送る
        emptyText: '未設定（発言したチャンネルに送信）'
    },
    bomb_mode: {
        label: '特殊爆弾モード通知',
        fallback: () => '1453193177581486100'
    },
    daily_event: {
        label: 'デイリーイベント告知',
        fallback: () => '1530865975455649902'
    },
    shard: {
        label: 'シャード通知',
        fallback: () => '1530865975455649902'
    },
    radio: {
        label: 'ラジオ体操の告知',
        fallback: () => '1453193177581486100'
    }
};

function getNotifyChannelId(key) {
    const def = NOTIFY_CHANNELS[key];
    if (!def) throw new Error(`unknown notify channel key: ${key}`);

    const custom = loadData().notifyChannels[key];
    return custom || def.fallback() || '';
}

function isCustomNotifyChannel(key) {
    return Boolean(loadData().notifyChannels[key]);
}

function setNotifyChannel(data, key, channelId) {
    if (!data.notifyChannels) data.notifyChannels = {};
    data.notifyChannels[key] = String(channelId);
}

function resetNotifyChannel(data, key) {
    if (data.notifyChannels) delete data.notifyChannels[key];
}

module.exports = {
    NOTIFY_CHANNELS,
    getNotifyChannelId,
    isCustomNotifyChannel,
    setNotifyChannel,
    resetNotifyChannel
};
