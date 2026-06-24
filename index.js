require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    PermissionsBitField,
    Partials,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require('discord.js');

const {
    initDataStore,
    loadData,
    saveData,
    ensureUser,
    addPoints,
    addPointLog
} = require('./utils/dataManager');
const omikujiData = require('./config/omikuji');
const checkLevelUp = require('./utils/levelManager');
const shop = require('./config/shop');
const gacha = require('./config/gacha');
const settings = require('./config/settings');

const ADMIN_USER_ID = "961521384264175626";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ]
});

const ROLE_MAP = {
    "1365915285613182977": "1505148838346887228",
    "1225420846475247726": "1505150004627505283",
    "1003612342027833375": "1505149957215358996",
    "1029730900507906088": "1505150121468366978",
    "1476162901059305472": "1505149923677573190",
    "834745010900566046": "1505149190160912455",
    "1462957880943575111": "1505149344980930750",
    "260269196724797451": "1505150679906254961",
    "637474054927941643": "1505150622108876880",
    "718082438953173062": "1505839509500198942",
    "1351184608850612324": "1505150031915913246",
    "1240635630942425211": "1507285402199785563",
    "1323585690490900584": "1507285234138484796"
};
function getColorRoleId(data, userId) {
    if (!data.colorRoleMap) {
        data.colorRoleMap = {};
    }

    return (
        data.colorRoleMap[userId] ||
        ROLE_MAP[userId] ||
        null
    );
}

function createEmbed(title, description, options = {}) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description || '\u200b')
        .setTimestamp();

    if (options.color) {
        embed.setColor(options.color);
    }

    if (options.footer) {
        embed.setFooter({ text: options.footer });
    }

    if (options.image) {
        embed.setImage(options.image);
    }

    if (options.thumbnail) {
        embed.setThumbnail(options.thumbnail);
    }

    return embed;
}

function guessEmbedColor(content) {
    const text = String(content || '');

    if (
        /失敗|不足|存在しない|できません|ありません|期限切れ|エラー|権限|無効/.test(text)
    ) {
        return 0xED4245;
    }

    if (
        /成功|追加|変更|購入|獲得|登録|解除|開始|終了|完了|有効化|無効化/.test(text)
    ) {
        return 0x57F287;
    }

    return 0x5865F2;
}

function guessEmbedTitle(content) {
    const text = String(content || '');

    if (
        /失敗|不足|存在しない|できません|ありません|期限切れ|エラー|権限/.test(text)
    ) {
        return '⚠️ エラー';
    }

    if (
        /成功|追加|変更|購入|獲得|登録|解除|完了/.test(text)
    ) {
        return '✅ 完了';
    }

    if (/開始/.test(text)) {
        return '🚀 開始';
    }

    if (/終了/.test(text)) {
        return '🏁 終了';
    }

    return 'お知らせ';
}

function contentToEmbedPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return payload;
    }

    if (payload.embeds || payload.content === undefined || payload.content === null) {
        return payload;
    }

    const rawContent = String(payload.content);
    const trimmed = rawContent.trim();

    if (!trimmed) {
        return payload;
    }

    const lines = trimmed.split('\n');
    let title = guessEmbedTitle(trimmed);
    let description = trimmed;

    if (lines.length > 1 && lines[0].length <= 80) {
        title = lines.shift().trim() || title;
        description = lines.join('\n').trim() || trimmed;
    }

    return {
        ...payload,
        content: '',
        embeds: [
            createEmbed(
                title,
                description.slice(0, 4096),
                {
                    color: guessEmbedColor(trimmed)
                }
            )
        ]
    };
}

function patchInteractionEmbed(interaction) {
    const originalReply = interaction.reply.bind(interaction);
    const originalEditReply = interaction.editReply?.bind(interaction);
    const originalUpdate = interaction.update?.bind(interaction);

    interaction.reply = (payload) => {
        return originalReply(contentToEmbedPayload(payload));
    };

    if (originalEditReply) {
        interaction.editReply = (payload) => {
            return originalEditReply(contentToEmbedPayload(payload));
        };
    }

    if (originalUpdate) {
        interaction.update = (payload) => {
            return originalUpdate(contentToEmbedPayload(payload));
        };
    }
}

const explosionGif =
    "https://tenor.com/view/jpexplosion-gif-5562858";

const timeoutList = [5, 10, 15, 30, 60];

const SPECIAL_BOMB_MODE_CHANNEL_ID = '1453193177581486100';
const SPECIAL_BOMB_RED_GIF = 'https://cdn.discordapp.com/attachments/1453193296011726868/1519289095501643907/4d6c59380065a2fb.gif?ex=6a3d03bb&is=6a3bb23b&hm=9730c6037f153f1127060873b19dfb1d2c88614f5abb3071c63de8ef8f38b44d&';
const SPECIAL_BOMB_MICHAEL_GIF = 'https://media.tenor.com/x8v1oNUOmg4AAAAd/explosion-anime.gif';
const SPECIAL_BOMB_START_RATE_MIN = 0.05;
const SPECIAL_BOMB_START_RATE_MAX = 0.10;
const SPECIAL_BOMB_MICHAEL_RATE_MIN = 0.01;
const SPECIAL_BOMB_MICHAEL_RATE_MAX = 0.20;
const SPECIAL_BOMB_ROLL_INTERVAL_MS = 30 * 60 * 1000;
const SPECIAL_BOMB_RATE_INTERVAL_MS = 10 * 60 * 1000;
const SPECIAL_BOMB_MESSAGE_LIMIT = 200;
const SPECIAL_BOMB_ROLL_CHANCE = 0.02;

const recentLevelNotices = new Map();

function getJstDateString() {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return jst.toISOString().slice(0, 10);
}

function getJstHourMinute() {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);

    return {
        hour: jst.getUTCHours(),
        minute: jst.getUTCMinutes()
    };
}

function rollDailyRoulette() {
    const table = [
        { chance: 0.5, points: 100 },
        { chance: 4.5, points: 75 },
        { chance: 5, points: 50 },
        { chance: 10, points: 35 },
        { chance: 10, points: 30 },
        { chance: 10, points: 25 },
        { chance: 20, points: 20 },
        { chance: 40, points: 10 }
    ];

    const roll = Math.random() * 100;
    let total = 0;

    for (const item of table) {
        total += item.chance;
        if (roll < total) return item.points;
    }

    return 10;
}

function pickRandom(array) {
    return array[Math.floor(Math.random() * array.length)];
}

function getRandomColor() {
    const r = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);

    const hex =
        '#' +
        r.toString(16).padStart(2, '0') +
        g.toString(16).padStart(2, '0') +
        b.toString(16).padStart(2, '0');

    return { r, g, b, hex };
}


function parseOmikujiColorCustomId(customId) {
    const parts = customId.split('_');

    const ownerId = parts[2];
    const primaryHex = '#' + parts[3];

    let secondaryHex = null;
    let buttonDate = parts[4];
    let colorMode = 'single';

    if (parts.length >= 7) {
        secondaryHex = '#' + parts[4];
        buttonDate = parts[5];
        colorMode = parts[6] || 'gradient';
    } else if (parts.length >= 6) {
        colorMode = parts[5] || 'single';
    }

    return {
        ownerId,
        primaryHex,
        secondaryHex,
        buttonDate,
        colorMode
    };
}

async function setRoleColorByMode(role, colorMode, primaryHex, secondaryHex = null) {
    if (colorMode === 'gradient' && secondaryHex) {
        const gradientColors = {
            primaryColor: primaryHex,
            secondaryColor: secondaryHex
        };

        if (typeof role.setColors === 'function') {
            return role.setColors(gradientColors);
        }

        try {
            return await role.edit({
                colors: gradientColors
            });
        } catch (err) {
            // discord.jsのバージョン差異対策
            return await role.edit({
                colors: {
                    primary_color: primaryHex,
                    secondary_color: secondaryHex
                }
            });
        }
    }

    return role.setColor(primaryHex);
}


function getMemberDisplayName(member) {
    if (!member) return null;
    return member.displayName || member.user?.globalName || member.user?.username || null;
}

async function getDisplayName(guild, userId) {
    try {
        const member = await guild.members.fetch(userId);
        return getMemberDisplayName(member) || userId;
    } catch {
        try {
            const user = await client.users.fetch(userId);
            return user.globalName || user.username || userId;
        } catch {
            return userId;
        }
    }
}

function getInteractionDisplayName(interaction) {
    return interaction.member?.displayName ||
        interaction.user?.globalName ||
        interaction.user?.username ||
        interaction.user?.id ||
        'Unknown';
}


function createShortId(prefix = '') {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function truncateText(text, maxLength = 80) {
    const value = String(text || '');
    return value.length > maxLength ? value.slice(0, maxLength - 1) + '…' : value;
}

function getPercent(count, total) {
    if (!total) return '0.0';
    return ((count / total) * 100).toFixed(1);
}

function getJstParts(date = new Date()) {
    const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);

    return {
        year: jst.getUTCFullYear(),
        month: jst.getUTCMonth() + 1,
        day: jst.getUTCDate(),
        hour: jst.getUTCHours(),
        minute: jst.getUTCMinutes()
    };
}

function formatJstDateTime(value) {
    if (!value) return '未設定';

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '不明';

    const p = getJstParts(date);

    return (
        `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ` +
        `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} JST`
    );
}

function parseAnonPollEndTime(rawInput) {
    const input = String(rawInput || '').trim();

    if (!input) {
        return { ok: true, endAt: null };
    }

    const now = new Date();

    const relativeMatch = input.match(/^(\d{1,4})\s*([mhd分時日])$/i);
    if (relativeMatch) {
        const amount = Number(relativeMatch[1]);
        const unit = relativeMatch[2].toLowerCase();
        let ms = 0;

        if (unit === 'm' || unit === '分') ms = amount * 60 * 1000;
        if (unit === 'h' || unit === '時') ms = amount * 60 * 60 * 1000;
        if (unit === 'd' || unit === '日') ms = amount * 24 * 60 * 60 * 1000;

        if (!ms) {
            return { ok: false, error: '終了時間の単位が不正です。' };
        }

        return { ok: true, endAt: new Date(now.getTime() + ms).toISOString() };
    }

    const dateTimeMatch = input.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})[ T](\d{1,2}):(\d{2})$/);
    if (dateTimeMatch) {
        const [, y, mo, d, h, mi] = dateTimeMatch.map(Number);
        const endDate = new Date(Date.UTC(y, mo - 1, d, h - 9, mi, 0));

        if (Number.isNaN(endDate.getTime())) {
            return { ok: false, error: '終了日時を読み取れませんでした。' };
        }

        return { ok: true, endAt: endDate.toISOString() };
    }

    const timeMatch = input.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
        const hour = Number(timeMatch[1]);
        const minute = Number(timeMatch[2]);

        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            return { ok: false, error: '時刻は 00:00〜23:59 の範囲で指定してください。' };
        }

        const p = getJstParts(now);
        let endDate = new Date(Date.UTC(p.year, p.month - 1, p.day, hour - 9, minute, 0));

        if (endDate.getTime() <= now.getTime()) {
            endDate = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
        }

        return { ok: true, endAt: endDate.toISOString() };
    }

    return {
        ok: false,
        error: '終了時間は `23:00`、`2026-06-18 23:00`、`30m`、`2h`、`1d` の形式で指定してください。'
    };
}

function isAnonPollExpired(poll) {
    return Boolean(
        poll &&
        poll.endAt &&
        !poll.closed &&
        new Date(poll.endAt).getTime() <= Date.now()
    );
}

function closeAnonPoll(poll, reason = 'time') {
    if (!poll || poll.closed) return false;

    poll.closed = true;
    poll.closeReason = reason;
    poll.closedAt = new Date().toISOString();

    return true;
}

function buildJoinVoteEmbed(vote) {
    const statusText =
        vote.closed
            ? (vote.result === 'approve' ? '許可に決定' : '許可されませんでした')
            : '投票受付中';

    return createEmbed(
        '🗳️ 参加許可投票',
        `対象者: <@${vote.targetUserId}>\n` +
        `対象ロール: <@&${vote.roleId}>\n` +
        (vote.reason ? `内容: ${vote.reason}\n` : '') +
        `状態: ${statusText}\n\n` +
        `✅ 許可: ${vote.approveCount}/${vote.approveThreshold}\n` +
        `❌ 許可しない: ${vote.denyCount}/${vote.denyThreshold}\n` +
        `投票対象人数: ${vote.totalVoters}人\n\n` +
        `※誰がどちらを押したかは表示されません。`,
        {
            color: vote.closed
                ? (vote.result === 'approve' ? 0x57F287 : 0xED4245)
                : 0x5865F2
        }
    );
}

function buildJoinVoteRow(voteId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`joinvote_approve_${voteId}`)
            .setLabel('許可')
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId(`joinvote_deny_${voteId}`)
            .setLabel('許可しない')
            .setStyle(ButtonStyle.Danger)
    );
}

function buildAnonPollEmbed(poll) {
    const totalVotes =
        poll.counts.reduce((sum, count) => sum + Number(count || 0), 0);

    const statusText = poll.closed
        ? '終了'
        : (poll.endAt ? `受付中 / 終了予定: ${formatJstDateTime(poll.endAt)}` : '受付中');

    let description =
        `作成者: <@${poll.creatorId}>\n` +
        `状態: ${statusText}\n` +
        `総投票数: ${totalVotes}票\n\n`;

    for (let i = 0; i < poll.choices.length; i++) {
        const count = Number(poll.counts[i] || 0);
        description +=
            `${i + 1}. ${poll.choices[i]}\n` +
            `　${count}票 / ${getPercent(count, totalVotes)}%\n`;
    }

    if (poll.closed) {
        description += `\n終了時刻: ${formatJstDateTime(poll.closedAt || poll.endAt)}`;
    }

    description += '\n※誰がどれを押したかは表示されません。';

    return createEmbed(
        `📊 ${poll.title}`,
        description,
        { color: poll.closed ? 0x747F8D : 0x5865F2 }
    );
}

function buildAnonPollRows(pollId, poll) {
    const rows = [];
    let currentRow = new ActionRowBuilder();
    const disabled = Boolean(poll.closed);

    for (let i = 0; i < poll.choices.length; i++) {
        if (i > 0 && i % 5 === 0) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
        }

        currentRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`anonpoll_vote_${pollId}_${i}`)
                .setLabel(`${i + 1}. ${truncateText(poll.choices[i], 70)}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(disabled)
        );
    }

    rows.push(currentRow);
    return rows;
}

function buildHalfGameRow(ownerId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`half_A_${ownerId}`)
            .setLabel('A')
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId(`half_B_${ownerId}`)
            .setLabel('B')
            .setStyle(ButtonStyle.Primary)
    );
}


function isBombMutedChannel(data, channel) {
    if (!data.mutedBombChannels) {
        data.mutedBombChannels = [];
    }

    const ids = data.mutedBombChannels.map(String);

    if (ids.includes(String(channel.id))) {
        return true;
    }

    // スレッド内なら親チャンネルも見る
    if (channel.parentId && ids.includes(String(channel.parentId))) {
        return true;
    }

    return false;
}

function getVcDecayMultiplier(minutes) {
    const hour = Math.floor(minutes / 60);

    if (hour <= 0) return 1.0;
    if (hour === 1) return 0.9;
    if (hour === 2) return 0.8;
    if (hour === 3) return 0.7;
    if (hour === 4) return 0.6;

    return 0.5;
}

async function announceLevelUp(guild, member, result, fallbackChannel = null) {
    if (!result.leveledUp) return;

    const key = `${member.id}:${result.newLevel}`;
    const now = Date.now();
    const last = recentLevelNotices.get(key);

    // 30秒以内の同じLv通知は無視
    if (last && now - last < 30 * 1000) {
        return;
    }

    recentLevelNotices.set(key, now);

    let channel = fallbackChannel;

    if (settings.LEVEL_ANNOUNCE_CHANNEL_ID) {
        try {
            channel = await guild.channels.fetch(settings.LEVEL_ANNOUNCE_CHANNEL_ID);
        } catch {}
    }

    if (!channel || !channel.send) return;

    await channel.send(
        `🎉 <@${member.id}> が Lv.${result.newLevel} にレベルアップしました！`
    );
}

async function addEarnedPointsAndCheckLevel({
    guild,
    member,
    data,
    amount,
    fallbackChannel = null
}) {
    addPoints(data, member.id, amount, { addToLevel: true });

    const result = await checkLevelUp(member, data.users[member.id]);

    await announceLevelUp(guild, member, result, fallbackChannel);
}


function ensureBombModeState(data) {
    if (!data.bombMode) {
        data.bombMode = {
            active: false,
            type: null,
            remainingMessages: 0,
            currentRate: 0,
            startedAt: null,
            nextRateChangeAt: null,
            announceChannelId: null
        };
    }

    data.bombMode.active = Boolean(data.bombMode.active);
    data.bombMode.type = data.bombMode.type || null;
    data.bombMode.remainingMessages = Number(data.bombMode.remainingMessages || 0);
    data.bombMode.currentRate = Number(data.bombMode.currentRate || 0);
    data.bombMode.startedAt = data.bombMode.startedAt || null;
    data.bombMode.nextRateChangeAt = data.bombMode.nextRateChangeAt || null;
    data.bombMode.announceChannelId = data.bombMode.announceChannelId || null;
    return data.bombMode;
}

function randomRate(min, max) {
    return Number((Math.random() * (max - min) + min).toFixed(4));
}

function getBombChance(data) {
    const mode = data?.bombMode;
    if (mode?.active && Number(mode.currentRate) > 0) {
        return Number(mode.currentRate);
    }
    return Number(settings.BOMB_CHANCE || 0.05);
}

function formatBombRate(rate) {
    return `${(Number(rate || 0) * 100).toFixed(2)}%`;
}

function getExplosionGif(data) {
    const mode = data?.bombMode;
    if (mode?.active) {
        if (mode.type === 'redshard') return SPECIAL_BOMB_RED_GIF;
        if (mode.type === 'michael') return SPECIAL_BOMB_MICHAEL_GIF;
    }
    return explosionGif;
}

function pickSpecialBombMode() {
    return Math.random() < 0.5 ? 'redshard' : 'michael';
}

function buildSpecialBombEmbed(type, stage, bombMode) {
    const remaining = Number(bombMode?.remainingMessages || 0);
    const rateText = formatBombRate(bombMode?.currentRate || 0);

    if (type === 'redshard') {
        if (stage === 'end') {
            return createEmbed(
                '🟥 赤シャード終了',
                '*原罪よりこの地方に来た闇は浄化されたようです*',
                {
                    color: 0x8B0000,
                    image: SPECIAL_BOMB_RED_GIF
                }
            );
        }

        return createEmbed(
            '🟥 赤シャード発生',
            `*闇はCaffe Latteに墜ちたようです*\n\n` +
            `爆発率: ${rateText}\n` +
            `残りメッセージ数: ${remaining}`,
            {
                color: 0xCC0000,
                image: SPECIAL_BOMB_RED_GIF
            }
        );
    }

    if (type === 'michael') {
        if (stage === 'end') {
            return createEmbed(
                '👋 マイケルモード終了',
                'じゃ、またな！',
                {
                    color: 0x5865F2,
                    image: SPECIAL_BOMB_MICHAEL_GIF
                }
            );
        }

        if (stage === 'rate') {
            return createEmbed(
                '💥 マイケル通信',
                `現在の爆発率：${rateText}\n` +
                `残りメッセージ数：${remaining}`,
                {
                    color: 0xF1C40F,
                    image: SPECIAL_BOMB_MICHAEL_GIF
                }
            );
        }

        return createEmbed(
            '💥 マイケルモード発動',
            `やぁ！俺だ！\n\n` +
            `爆発率が10分ごとに変動します。\n` +
            `現在の爆発率：${rateText}\n` +
            `残りメッセージ数：${remaining}`,
            {
                color: 0xF1C40F,
                image: SPECIAL_BOMB_MICHAEL_GIF
            }
        );
    }

    return createEmbed(
        '特殊モード',
        '不明なモードです。',
        { color: 0x5865F2 }
    );
}

async function sendSpecialBombEmbed(type, stage, bombMode) {
    try {
        const channel = await client.channels.fetch(SPECIAL_BOMB_MODE_CHANNEL_ID);
        if (!channel || !channel.send) return false;
        await channel.send({
            embeds: [buildSpecialBombEmbed(type, stage, bombMode)]
        });
        return true;
    } catch (err) {
        console.error(err);
        return false;
    }
}

async function stopSpecialBombMode(data, { reason = 'manual' } = {}) {
    const bombMode = ensureBombModeState(data);

    if (!bombMode.active) {
        return false;
    }

    const previous = { ...bombMode };
    bombMode.active = false;
    bombMode.type = null;
    bombMode.remainingMessages = 0;
    bombMode.currentRate = 0;
    bombMode.startedAt = null;
    bombMode.nextRateChangeAt = null;

    const announced = await sendSpecialBombEmbed(previous.type, 'end', previous);

    if (!announced && reason !== 'manual') {
        // 何もしない
    }

    return true;
}

async function startSpecialBombMode(data, type, { force = false } = {}) {
    const bombMode = ensureBombModeState(data);

    if (bombMode.active && !force) {
        return false;
    }

    if (bombMode.active && force) {
        await stopSpecialBombMode(data, { reason: 'force' });
    }

    const now = new Date();

    bombMode.active = true;
    bombMode.type = type;
    bombMode.remainingMessages = SPECIAL_BOMB_MESSAGE_LIMIT;
    bombMode.startedAt = now.toISOString();
    bombMode.announceChannelId = SPECIAL_BOMB_MODE_CHANNEL_ID;

    if (type === 'redshard') {
        bombMode.currentRate = randomRate(SPECIAL_BOMB_START_RATE_MIN, SPECIAL_BOMB_START_RATE_MAX);
        bombMode.nextRateChangeAt = null;
    } else if (type === 'michael') {
        bombMode.currentRate = randomRate(SPECIAL_BOMB_MICHAEL_RATE_MIN, SPECIAL_BOMB_MICHAEL_RATE_MAX);
        bombMode.nextRateChangeAt = new Date(now.getTime() + SPECIAL_BOMB_RATE_INTERVAL_MS).toISOString();
    } else {
        bombMode.currentRate = Number(settings.BOMB_CHANCE || 0.05);
        bombMode.nextRateChangeAt = null;
    }

    await sendSpecialBombEmbed(type, 'start', bombMode);

    return true;
}

async function refreshSpecialBombRate(data) {
    const bombMode = ensureBombModeState(data);

    if (!bombMode.active || bombMode.type !== 'michael') {
        return false;
    }

    const now = Date.now();
    let nextAt = bombMode.nextRateChangeAt
        ? new Date(bombMode.nextRateChangeAt).getTime()
        : 0;

    if (!nextAt) {
        bombMode.nextRateChangeAt = new Date(now + SPECIAL_BOMB_RATE_INTERVAL_MS).toISOString();
        return false;
    }

    let changed = false;

    while (nextAt && now >= nextAt && bombMode.active && bombMode.type === 'michael') {
        bombMode.currentRate = randomRate(
            SPECIAL_BOMB_MICHAEL_RATE_MIN,
            SPECIAL_BOMB_MICHAEL_RATE_MAX
        );
        bombMode.nextRateChangeAt = new Date(nextAt + SPECIAL_BOMB_RATE_INTERVAL_MS).toISOString();
        nextAt += SPECIAL_BOMB_RATE_INTERVAL_MS;
        changed = true;
    }

    if (changed) {
        await sendSpecialBombEmbed('michael', 'rate', bombMode);
    }

    return changed;
}

async function consumeSpecialBombMessage(data) {
    const bombMode = ensureBombModeState(data);

    if (!bombMode.active) {
        return false;
    }

    bombMode.remainingMessages = Math.max(0, bombMode.remainingMessages - 1);

    if (bombMode.remainingMessages <= 0) {
        await stopSpecialBombMode(data, { reason: 'messages' });
        return true;
    }

    return false;
}

async function handleSpecialBombRoll() {
    const data = loadData();
    const bombMode = ensureBombModeState(data);

    if (bombMode.active) return;

    if (Math.random() >= SPECIAL_BOMB_ROLL_CHANCE) return;

    const type = pickSpecialBombMode();
    const started = await startSpecialBombMode(data, type, { force: false });

    if (started) {
        saveData(data);
    }
}

async function handleSpecialBombTick() {
    const data = loadData();
    const changed = await refreshSpecialBombRate(data);

    if (changed) {
        saveData(data);
        return;
    }

    const bombMode = ensureBombModeState(data);
    if (bombMode.active && bombMode.type === 'michael' && !bombMode.nextRateChangeAt) {
        saveData(data);
    }
}


const commands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Botの応答確認'),

    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('ポイント・統計確認'),

    new SlashCommandBuilder()
        .setName('rank')
        .setDescription('ランキング')
        .addStringOption(option =>
            option
                .setName('type')
                .setDescription('ランキング種類')
                .setRequired(false)
                .addChoices(
                    { name: '所持ポイント', value: 'points' },
                    { name: 'レベル', value: 'level' },
                    { name: '作業時間', value: 'voice' },
                    { name: 'リアクション数', value: 'reaction' },
                    { name: 'メッセージ数', value: 'message' },
                    { name: '爆発回数', value: 'explosion' },
                    { name: '1/2^n 連続成功数', value: 'half' }
                )
        ),

    new SlashCommandBuilder()
        .setName('i-shop')
        .setDescription('ショップ'),

    new SlashCommandBuilder()
        .setName('i-buy')
        .setDescription('アイテム購入')
        .addStringOption(option =>
            option
                .setName('item')
                .setDescription('商品名')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('g-gacha')
        .setDescription('ガチャ'),

    new SlashCommandBuilder()
        .setName('m-addt')
        .setDescription('管理者専用：ガチャチケットを追加')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('追加する相手')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('追加する枚数')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('p-give')
        .setDescription('相手にポイントを譲渡')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('譲渡相手')
                .setRequired(true)
        )
        .addNumberOption(option =>
            option
                .setName('amount')
                .setDescription('譲渡ポイント')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('m-addp')
        .setDescription('管理者専用：ポイントを追加')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('追加する相手')
                .setRequired(true)
        )
        .addNumberOption(option =>
            option
                .setName('amount')
                .setDescription('追加するポイント')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('m-roleap')
        .setDescription('管理者専用：指定ロールの全員にポイントを付与')
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('対象ロール')
                .setRequired(true)
        )
        .addNumberOption(option =>
            option
                .setName('amount')
                .setDescription('付与ポイント')
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option
                .setName('level')
                .setDescription('Lv用ポイントにも加算するか')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('r-disp')
        .setDescription('表示用ロールを付け替え')
        .addStringOption(option =>
            option
                .setName('role')
                .setDescription('表示するロール名。noneで解除')
                .setRequired(true)
                .addChoices(
                    { name: 'なし', value: 'none' },
                    { name: '購入済みすべて', value: 'all' },
                    { name: '睡眠は偉業', value: '睡眠は偉業' },
                    { name: '食事は偉業', value: '食事は偉業' },
                    { name: 'ハーブティ提供中', value: 'ハーブティ提供中' },
                    { name: '異形は偉業', value: '異形は偉業' }
                )
        ),

    new SlashCommandBuilder()
        .setName('workcheck')
        .setDescription('作業確認をしてVC減衰をリセット'),

    new SlashCommandBuilder()
        .setName('log')
        .setDescription('直近20件のポイントログを表示'),

    new SlashCommandBuilder()
        .setName('g-double')
        .setDescription('ポイントを賭けてダブルアップ')
        .addNumberOption(option =>
            option
                .setName('amount')
                .setDescription('賭けるポイント')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('db-start')
        .setDescription('500ptを使ってダービーを開始')
        .addStringOption(option =>
            option
                .setName('title')
                .setDescription('ダービー名')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('db-list')
        .setDescription('開催中のダービー一覧'),

    new SlashCommandBuilder()
        .setName('db-join')
        .setDescription('開催中のダービーに参加')
        .addStringOption(option =>
            option
                .setName('id')
                .setDescription('ダービーID')
                .setRequired(true)
        )
        .addNumberOption(option =>
            option
                .setName('amount')
                .setDescription('賭けるポイント')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('db-result')
        .setDescription('ダービー結果を確定')
        .addStringOption(option =>
            option
                .setName('id')
                .setDescription('ダービーID')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('winners')
                .setDescription('勝者のメンション。勝者なしなら none')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('omikuji')
        .setDescription('今日のおみくじを引く')
        .addStringOption(option =>
            option
                .setName('mode')
                .setDescription('ラッキーカラーの種類')
                .setRequired(true)
                .addChoices(
                    { name: '通常カラー', value: 'single' },
                    { name: 'グラデーション', value: 'gradient' }
                )
        ),

    new SlashCommandBuilder()
        .setName('mutebomb')
        .setDescription('このチャンネルの爆弾ON/OFF'),

    new SlashCommandBuilder()
        .setName('m-bmode')
        .setDescription('管理者専用：爆発特殊モードのデバッグ制御')
        .addStringOption(option =>
            option
                .setName('mode')
                .setDescription('操作するモード')
                .setRequired(true)
                .addChoices(
                    { name: '赤シャードを強制開始', value: 'redshard' },
                    { name: 'マイケルを強制開始', value: 'michael' },
                    { name: '停止', value: 'off' }
                )
        ),

    new SlashCommandBuilder()
        .setName('cr-set')
        .setDescription('管理者：カラー設定ロールを登録')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('対象')
                .setRequired(true)
        )
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('カラー用ロール')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('cr-rem')
        .setDescription('自分のカラー用ロールを一時解除'),

    new SlashCommandBuilder()
        .setName('favlist')
        .setDescription('保存済みお気に入りカラーを表示'),

    new SlashCommandBuilder()
        .setName('favset')
        .setDescription('保存済みカラーに変更')
        .addIntegerOption(option =>
            option
                .setName('number')
                .setDescription('1 または 2')
                .setRequired(true)
                .addChoices(
                    { name: '1', value: 1 },
                    { name: '2', value: 2 }
                )
        ),

    new SlashCommandBuilder()
        .setName('favrem')
        .setDescription('保存済みカラーを削除')
        .addIntegerOption(option =>
            option
                .setName('number')
                .setDescription('1 または 2')
                .setRequired(true)
                .addChoices(
                    { name: '1', value: 1 },
                    { name: '2', value: 2 }
                )
        ),

    new SlashCommandBuilder()
        .setName('m-reset')
        .setDescription('管理者専用：一日一回制限をリセット')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('対象ユーザー')
                .setRequired(true)
        ),


    new SlashCommandBuilder()
        .setName('m-joinvote')
        .setDescription('管理者専用：参加許可投票を作成')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('参加を許可するか投票する対象ユーザー')
                .setRequired(true)
        )
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('投票対象兼、許可時に付与するロール')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('reason')
                .setDescription('投票の説明・理由')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('anonpoll')
        .setDescription('匿名アンケートを作成')
        .addStringOption(option =>
            option
                .setName('title')
                .setDescription('アンケートタイトル')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('choice1')
                .setDescription('選択肢1')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('choice2')
                .setDescription('選択肢2')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('choice3')
                .setDescription('選択肢3')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('choice4')
                .setDescription('選択肢4')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('choice5')
                .setDescription('選択肢5')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('choice6')
                .setDescription('選択肢6')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('choice7')
                .setDescription('選択肢7')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('choice8')
                .setDescription('選択肢8')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('choice9')
                .setDescription('選択肢9')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('choice10')
                .setDescription('選択肢10')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('end')
                .setDescription('終了時間。例: 23:00 / 2026-06-18 23:00 / 30m / 2h / 1d')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('g-half')
        .setDescription('1/2^nゲームを開始'),

    new SlashCommandBuilder()
        .setName('d-notify')
        .setDescription('デイリーおみくじ通知の受け取り設定')
        .addStringOption(option =>
            option
                .setName('mode')
                .setDescription('通知設定')
                .setRequired(true)
                .addChoices(
                    { name: '受け取る', value: 'on' },
                    { name: '受け取らない', value: 'off' }
                )
        ),

].map(c => c.toJSON());

const rest =
    new REST({ version: '10' })
        .setToken(process.env.TOKEN);

client.once('clientReady', async () => {
    console.log(`${client.user.tag} 起動`);

    await initDataStore();

    await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
    );

    setInterval(handleVoicePoints, 60 * 1000);
    setInterval(handleDailyReminder, 60 * 1000);
    setInterval(handleAnonPollDeadlines, 60 * 1000);
    setInterval(handleSpecialBombRoll, SPECIAL_BOMB_ROLL_INTERVAL_MS);
    setInterval(handleSpecialBombTick, 60 * 1000);
});

async function handleVoicePoints() {
    const data = loadData();

    for (const guild of client.guilds.cache.values()) {
        await guild.members.fetch();

        const voiceMembers =
            guild.members.cache.filter(member =>
                !member.user.bot &&
                member.voice.channel
            );

        for (const member of voiceMembers.values()) {
            ensureUser(data, member.id);

            const user = data.users[member.id];

            user.voiceMinutesTotal += 1;

            const isStreaming = member.voice.streaming;
            const micOn =
                !member.voice.selfMute &&
                !member.voice.serverMute;

            const workCheckedRecently =
                Date.now() - user.lastWorkCheck <=
                settings.WORK_CHECK_RESET_MINUTES * 60 * 1000;

            if (isStreaming || micOn || workCheckedRecently) {
                user.vcSessionMinutes = 0;
            } else {
                user.vcSessionMinutes += 1;
            }

            const multiplier =
                getVcDecayMultiplier(user.vcSessionMinutes);

            const gain =
                settings.VC_POINT_PER_MINUTE * multiplier;

            await addEarnedPointsAndCheckLevel({
                guild,
                member,
                data,
                amount: gain,
                fallbackChannel: null
            });

            addPointLog(data, {
                userId: member.id,
                type: 'voice',
                amount: gain,
                hourly: true
            });
        }
    }

    saveData(data);
}

async function handleAnonPollDeadlines() {
    const data = loadData();

    if (!data.anonPolls) {
        data.anonPolls = {};
    }

    let changed = false;

    for (const poll of Object.values(data.anonPolls)) {
        if (!isAnonPollExpired(poll)) {
            continue;
        }

        closeAnonPoll(poll, 'time');
        changed = true;

        if (!poll.channelId || !poll.messageId) {
            continue;
        }

        try {
            const channel = await client.channels.fetch(poll.channelId);
            const message = await channel.messages.fetch(poll.messageId);

            await message.edit({
                embeds: [buildAnonPollEmbed(poll)],
                components: []
            });
        } catch (err) {
            console.error(err);
        }
    }

    if (changed) {
        saveData(data);
    }
}

async function handleDailyReminder() {
    const { hour, minute } = getJstHourMinute();
    const today = getJstDateString();

    if (
        hour !== settings.DAILY_REMINDER_HOUR_JST ||
        minute !== settings.DAILY_REMINDER_MINUTE_JST
    ) {
        return;
    }

    const data = loadData();

    if (data.dailyReminderSentDate === today) return;

    const channelId = settings.DAILY_REMINDER_CHANNEL_ID;
    if (!channelId || channelId.includes("ここに")) return;

    let channel;

    try {
        channel = await client.channels.fetch(channelId);
    } catch {
        return;
    }

    const mentions = [];

    for (const [targetUserId, userData] of Object.entries(data.users)) {
        if (
            userData.lastOmikujiDate !== today &&
            !userData.dailyReminderMuted
        ) {
            mentions.push(`<@${targetUserId}>`);
        }
    }

    if (mentions.length > 0) {
        for (let i = 0; i < mentions.length; i += 30) {
            const chunk = mentions.slice(i, i + 30);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('daily_reminder_mute')
                    .setLabel('今後通知を受け取らない')
                    .setStyle(ButtonStyle.Secondary)
            );

            await channel.send({
                content:
                    `本日のおみくじがまだです！ ${chunk.join(' ')}\n` +
                    `/omikuji で今日のおみくじと無料ポイントを受け取れます。`,
                components: [row]
            });
        }
    }

    data.dailyReminderSentDate = today;
    saveData(data);
}

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const data = loadData();

    ensureUser(data, message.author.id);

    const member =
        await message.guild.members.fetch(message.author.id);

    data.users[message.author.id].messageCount += 1;

    await addEarnedPointsAndCheckLevel({
        guild: message.guild,
        member,
        data,
        amount: settings.MESSAGE_POINT,
        fallbackChannel: message.channel
    });

    addPointLog(data, {
        userId: message.author.id,
        type: 'message',
        amount: settings.MESSAGE_POINT,
        hourly: true
    });

    await refreshSpecialBombRate(data);

    if (!isBombMutedChannel(data, message.channel)) {
        const bombChance = getBombChance(data);

        if (Math.random() <= bombChance) {
            try {
                const seconds =
                    timeoutList[Math.floor(Math.random() * timeoutList.length)];

                data.users[message.author.id].explosionCount =
                    (data.users[message.author.id].explosionCount || 0) + 1;

                const currentGif = getExplosionGif(data);
                await message.channel.send(
                    `${currentGif}\n` +
                    `<@${message.author.id}>じゃ！ \n` +
                    `${seconds}.`
                );

                if (
                    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                    !member.moderatable
                ) {
                    await message.channel.send(
                        `💥 ただし権限が強すぎてタイムアウトできませんでした。`
                    );
                } else {
                    await member.timeout(seconds * 1000, '爆弾');
                }
            } catch (err) {
                console.error(err);
            }
        }
    }

    await consumeSpecialBombMessage(data);

    saveData(data);
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    try {
        if (reaction.partial) await reaction.fetch();
    } catch {
        return;
    }

    const message = reaction.message;
    if (!message.guild) return;

    const data = loadData();

    const member =
        await message.guild.members.fetch(user.id);

    ensureUser(data, user.id);
    data.users[user.id].reactionCount += 1;

    await addEarnedPointsAndCheckLevel({
        guild: message.guild,
        member,
        data,
        amount: settings.REACTION_POINT,
        fallbackChannel: message.channel
    });

    addPointLog(data, {
        userId: user.id,
        type: 'reaction',
        amount: settings.REACTION_POINT,
        hourly: true
    });

    saveData(data);
});

client.on('interactionCreate', async interaction => {
    patchInteractionEmbed(interaction);

    // ボタン処理
    if (interaction.isButton()) {
        const data = loadData();

        if (interaction.customId === 'daily_reminder_mute') {
            const buttonUserId = interaction.user.id;

            ensureUser(data, buttonUserId);
            data.users[buttonUserId].dailyReminderMuted = true;

            saveData(data);

            return interaction.reply({
                content: '今後、デイリーおみくじ未実行通知を受け取らないようにしました。',
                ephemeral: true
            });
        }


        if (interaction.customId.startsWith('joinvote_')) {
            const parts = interaction.customId.split('_');
            const action = parts[1];
            const voteId = parts[2];

            if (!data.joinVotes) data.joinVotes = {};
            const vote = data.joinVotes[voteId];

            if (!vote) {
                return interaction.reply({
                    content: 'この投票データが見つかりません。',
                    ephemeral: true
                });
            }

            if (vote.closed) {
                return interaction.reply({
                    content: 'この投票はすでに終了しています。',
                    ephemeral: true
                });
            }

            const voterId = interaction.user.id;
            const voterMember = await interaction.guild.members.fetch(voterId);

            if (!voterMember.roles.cache.has(vote.roleId)) {
                return interaction.reply({
                    content: 'この投票に参加できる対象ロールを持っていません。',
                    ephemeral: true
                });
            }

            if (vote.voters[voterId]) {
                return interaction.reply({
                    content: 'すでに投票済みです。',
                    ephemeral: true
                });
            }

            vote.voters[voterId] = action;

            if (action === 'approve') {
                vote.approveCount += 1;
            } else {
                vote.denyCount += 1;
            }

            let resultMessage = null;

            if (vote.approveCount >= vote.approveThreshold) {
                vote.closed = true;
                vote.result = 'approve';

                try {
                    const targetMember =
                        await interaction.guild.members.fetch(vote.targetUserId);

                    if (!targetMember.roles.cache.has(vote.roleId)) {
                        await targetMember.roles.add(vote.roleId);
                    }
                } catch (err) {
                    console.error(err);
                }

                resultMessage =
                    `投票の結果、<@${vote.targetUserId}> は <@&${vote.roleId}> への参加を許可に決定いたしました。`;
            } else if (vote.denyCount >= vote.denyThreshold) {
                vote.closed = true;
                vote.result = 'deny';

                resultMessage =
                    `投票の結果、<@${vote.targetUserId}> の <@&${vote.roleId}> への参加は許可されませんでした。`;
            }

            saveData(data);

            await interaction.update({
                embeds: [buildJoinVoteEmbed(vote)],
                components: vote.closed ? [] : [buildJoinVoteRow(voteId)]
            });

            if (resultMessage) {
                await interaction.channel.send(resultMessage);
            }

            return;
        }

        if (interaction.customId.startsWith('anonpoll_vote_')) {
            const parts = interaction.customId.split('_');
            const pollId = parts[2];
            const choiceIndex = Number(parts[3]);

            if (!data.anonPolls) data.anonPolls = {};
            const poll = data.anonPolls[pollId];

            if (!poll) {
                return interaction.reply({
                    content: 'このアンケートデータが見つかりません。',
                    ephemeral: true
                });
            }

            if (!Number.isInteger(choiceIndex) || !poll.choices[choiceIndex]) {
                return interaction.reply({
                    content: '存在しない選択肢です。',
                    ephemeral: true
                });
            }

            if (poll.closed || isAnonPollExpired(poll)) {
                closeAnonPoll(poll, poll.closed ? (poll.closeReason || 'closed') : 'time');
                saveData(data);

                await interaction.update({
                    embeds: [buildAnonPollEmbed(poll)],
                    components: []
                });

                return interaction.followUp({
                    content: 'このアンケートは終了しています。',
                    ephemeral: true
                });
            }

            if (poll.voters[interaction.user.id] !== undefined) {
                return interaction.reply({
                    content: 'すでに投票済みです。',
                    ephemeral: true
                });
            }

            poll.voters[interaction.user.id] = choiceIndex;
            poll.counts[choiceIndex] += 1;

            saveData(data);

            return interaction.update({
                embeds: [buildAnonPollEmbed(poll)],
                components: poll.closed ? [] : buildAnonPollRows(pollId, poll)
            });
        }

        if (interaction.customId.startsWith('half_')) {
            const parts = interaction.customId.split('_');
            const action = parts[1];
            const ownerId = parts[2];

            if (interaction.user.id !== ownerId) {
                return interaction.reply({
                    content: 'これはあなたの1/2^nゲームではありません。',
                    ephemeral: true
                });
            }

            ensureUser(data, ownerId);

            if (!data.halfGames) data.halfGames = {};
            const game = data.halfGames[ownerId];

            if (!game || !game.active) {
                return interaction.reply({
                    content: 'この1/2^nゲームは終了しています。',
                    ephemeral: true
                });
            }

            const answer = Math.random() < 0.5 ? 'A' : 'B';

            if (action === answer) {
                game.current += 1;

                if ((data.users[ownerId].halfBest || 0) < game.current) {
                    data.users[ownerId].halfBest = game.current;
                }

                saveData(data);

                return interaction.update({
                    content:
                        `🎯 成功！答えは ${answer} でした。\n` +
                        `現在 ${game.current} 連続成功中です。\n` +
                        `自己ベスト: ${data.users[ownerId].halfBest || 0}連続\n` +
                        `次もAかBを選んでください。`,
                    components: [buildHalfGameRow(ownerId)]
                });
            }

            const finalStreak = game.current;

            if ((data.users[ownerId].halfBest || 0) < finalStreak) {
                data.users[ownerId].halfBest = finalStreak;
            }

            delete data.halfGames[ownerId];

            saveData(data);

            return interaction.update({
                content:
                    `💥 失敗！答えは ${answer} でした。\n` +
                    `最終記録: ${finalStreak}連続成功\n` +
                    `自己ベスト: ${data.users[ownerId].halfBest || 0}連続`,
                components: []
            });
        }

        // おみくじ：ラッキーカラー変更
        if (interaction.customId.startsWith('omikuji_color_')) {
            const {
                ownerId,
                primaryHex,
                secondaryHex,
                buttonDate,
                colorMode
            } = parseOmikujiColorCustomId(interaction.customId);

            if (interaction.user.id !== ownerId) {
                return interaction.reply({
                    content: 'これはあなたのおみくじではありません。',
                    ephemeral: true
                });
            }

            ensureUser(data, ownerId);

            if (buttonDate !== getJstDateString()) {
                return interaction.reply({
                    content: 'このおみくじは期限切れです。',
                    ephemeral: true
                });
            }

            const roleId = getColorRoleId(data, ownerId);

            if (!roleId) {
                return interaction.reply({
                    content: 'カラー設定ロールがありません。',
                    ephemeral: true
                });
            }

            try {
                const role = await interaction.guild.roles.fetch(roleId);
                await setRoleColorByMode(role, colorMode, primaryHex, secondaryHex);

                const colorLabel =
                    colorMode === 'gradient' && secondaryHex
                        ? `${primaryHex} → ${secondaryHex}`
                        : primaryHex;

                return interaction.reply({
                    content: `🎨 ラッキーカラー ${colorLabel} に変更しました！`,
                    ephemeral: true
                });
            } catch (err) {
                console.error(err);

                return interaction.reply({
                    content: 'カラー変更に失敗しました。Botのロール位置や権限、またはグラデーションカラー対応状況を確認してください。',
                    ephemeral: true
                });
            }
        }

        // おみくじ：お気に入り登録してラッキーカラー変更
        if (interaction.customId.startsWith('omikuji_savecolor_')) {
            const {
                ownerId,
                primaryHex,
                secondaryHex,
                buttonDate,
                colorMode
            } = parseOmikujiColorCustomId(interaction.customId);

            if (interaction.user.id !== ownerId) {
                return interaction.reply({
                    content: 'これはあなたのおみくじではありません。',
                    ephemeral: true
                });
            }

            ensureUser(data, ownerId);
            const user = data.users[ownerId];

            if (!user.favoriteColors) user.favoriteColors = [];

            if (buttonDate !== getJstDateString()) {
                return interaction.reply({
                    content: 'このおみくじは期限切れです。',
                    ephemeral: true
                });
            }

            const roleId = getColorRoleId(data, ownerId);

            if (!roleId) {
                return interaction.reply({
                    content: 'カラー設定ロールがありません。',
                    ephemeral: true
                });
            }

            if (user.favoriteColors.length >= 2) {
                return interaction.reply({
                    content: 'お気に入りカラーは最大2つまでです。\n/favrem で先に削除してください。',
                    ephemeral: true
                });
            }

            try {
                const role = await interaction.guild.roles.fetch(roleId);
                const currentColor = role.hexColor || '#000000';

                if (user.favoriteColors.includes(currentColor)) {
                    return interaction.reply({
                        content: `現在の色 ${currentColor} はすでにお気に入り登録されています。`,
                        ephemeral: true
                    });
                }

                await setRoleColorByMode(role, colorMode, primaryHex, secondaryHex);

                user.favoriteColors.push(currentColor);
                saveData(data);

                const colorLabel =
                    colorMode === 'gradient' && secondaryHex
                        ? `${primaryHex} → ${secondaryHex}`
                        : primaryHex;

                return interaction.reply({
                    content:
                        `⭐ 現在の色 ${currentColor} をお気に入り登録しました。\n` +
                        `🎨 ラッキーカラー ${colorLabel} に変更しました。`,
                    ephemeral: true
                });
            } catch (err) {
                console.error(err);

                return interaction.reply({
                    content: 'カラー変更に失敗しました。Botのロール位置や権限、またはグラデーションカラー対応状況を確認してください。',
                    ephemeral: true
                });
            }
        }

        // ダブルアップ
        if (interaction.customId.startsWith('doubleup_')) {
            const parts = interaction.customId.split('_');
            const action = parts[1];
            const ownerId = parts[2];

            if (interaction.user.id !== ownerId) {
                return interaction.reply({
                    content: 'これはあなたのダブルアップではありません。',
                    ephemeral: true
                });
            }

            ensureUser(data, ownerId);

            const game = data.doubleUps?.[ownerId];

            if (!game || !game.active) {
                return interaction.reply({
                    content: 'このダブルアップは終了しています。',
                    ephemeral: true
                });
            }

            if (action === 'stop') {
                data.users[ownerId].points += game.current;

                addPointLog(data, {
                    userId: ownerId,
                    type: 'doubleup-cashout',
                    amount: game.current,
                    detail: 'cash out'
                });

                delete data.doubleUps[ownerId];

                saveData(data);

                return interaction.update({
                    content:
                        `✅ ダブルアップ終了！\n` +
                        `${game.current}pt を受け取りました。`,
                    components: []
                });
            }

            const answer = Math.random() < 0.5 ? 'A' : 'B';

            if (action === answer) {
                game.current *= 2;

                saveData(data);

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`doubleup_A_${ownerId}`)
                        .setLabel('A')
                        .setStyle(ButtonStyle.Primary),

                    new ButtonBuilder()
                        .setCustomId(`doubleup_B_${ownerId}`)
                        .setLabel('B')
                        .setStyle(ButtonStyle.Primary),

                    new ButtonBuilder()
                        .setCustomId(`doubleup_stop_${ownerId}`)
                        .setLabel('終了して受け取る')
                        .setStyle(ButtonStyle.Success)
                );

                return interaction.update({
                    content:
                        `🎯 正解！答えは ${answer} でした。\n` +
                        `現在の山分: ${game.current}pt\n` +
                        `続けますか？`,
                    components: [row]
                });
            }

            addPointLog(data, {
                userId: ownerId,
                type: 'doubleup-lose',
                amount: 0,
                detail: `lost ${game.current}pt`
            });

            delete data.doubleUps[ownerId];

            saveData(data);

            return interaction.update({
                content:
                    `💥 失敗！答えは ${answer} でした。\n` +
                    `賭けポイントは失われました。`,
                components: []
            });
        }

        return;
    }

    // SlashCommand以外は無視
    if (!interaction.isChatInputCommand()) return;

    const data = loadData();
    const userId = interaction.user.id;

    ensureUser(data, userId);
    if (interaction.commandName === 'ping') {
        return interaction.reply({
            content: `🏓 Pong! ${client.ws.ping}ms`
        });
    }

    if (interaction.commandName === 'd-notify') {
        const mode = interaction.options.getString('mode');

        data.users[userId].dailyReminderMuted = mode === 'off';

        saveData(data);

        return interaction.reply({
            content:
                mode === 'off'
                    ? 'デイリーおみくじ未実行通知を受け取らないようにしました。'
                    : 'デイリーおみくじ未実行通知を受け取るようにしました。',
            ephemeral: true
        });
    }


    if (interaction.commandName === 'm-bmode') {
        if (
            !interaction.member.permissions.has(
                PermissionsBitField.Flags.Administrator
            )
        ) {
            return interaction.reply({
                content: '管理者専用です。',
                ephemeral: true
            });
        }

        const mode = interaction.options.getString('mode');

        if (mode === 'off') {
            const stopped = await stopSpecialBombMode(data, { reason: 'manual' });

            if (stopped) {
                saveData(data);

                return interaction.reply({
                    content: '特殊爆発モードを終了しました。',
                    ephemeral: true
                });
            }

            return interaction.reply({
                content: '現在、特殊爆発モードは起動していません。',
                ephemeral: true
            });
        }

        const started = await startSpecialBombMode(data, mode, { force: true });

        if (started) {
            saveData(data);

            return interaction.reply({
                content:
                    mode === 'redshard'
                        ? '赤シャードモードを強制開始しました。'
                        : 'マイケルモードを強制開始しました。',
                ephemeral: true
            });
        }

        return interaction.reply({
            content: '特殊爆発モードの開始に失敗しました。',
            ephemeral: true
        });
    }

    if (interaction.commandName === 'm-reset') {
        if (
            !interaction.member.permissions.has(
                PermissionsBitField.Flags.Administrator
            )
        ) {
            return interaction.reply({
                content: '管理者専用です。',
                ephemeral: true
            });
        }

        const target = interaction.options.getUser('user');

        ensureUser(data, target.id);

        data.users[target.id].lastOmikujiDate = null;
        data.users[target.id].lastDailyDate = null;

        saveData(data);

        return interaction.reply({
            content:
                `<@${target.id}> の一日一回制限をリセットしました。\n` +
                `再度 /omikuji を実行できます。`,
            ephemeral: true
        });
    }

    if (interaction.commandName === 'cr-set') {
        if (
            !interaction.member.permissions.has(
                PermissionsBitField.Flags.Administrator
            )
        ) {
            return interaction.reply({
                content:'管理者専用',
                ephemeral:true
            });
        }

        const target =
            interaction.options.getUser(
                'user'
            );

        const role =
            interaction.options.getRole(
                'role'
            );

        if (!data.colorRoleMap) {
            data.colorRoleMap = {};
        }

        data.colorRoleMap[
            target.id
        ] = role.id;

        saveData(data);

        return interaction.reply({
            content:
            `<@${target.id}> → <@&${role.id}> を登録しました`
        });
    }

if (
    interaction.commandName ===
    'cr-rem'
) {

    const target = interaction.user;

    const roleId =
        getColorRoleId(
            data,
            target.id
        );

    if (!roleId) {
        return interaction.reply({
            content:
            'カラー設定ロールが登録されていません。',
            ephemeral:true
        });
    }

    const member =
        await interaction.guild.members.fetch(
            target.id
        );

    if (!data.detachedColorRoles) {
        data.detachedColorRoles = {};
    }

    try {

        if (
            member.roles.cache.has(roleId)
        ) {
            await member.roles.remove(
                roleId
            );
        }

        data.detachedColorRoles[
            target.id
        ] = roleId;

        saveData(data);

        return interaction.reply({
            content:
            `🎨 カラー用ロールを一時的に外しました。\n` +
            `次回 /omikuji で自動復帰します。`,
            ephemeral:true
        });

    } catch(err){

        console.error(err);

        return interaction.reply({
            content:
            'ロールを外せませんでした。',
            ephemeral:true
        });
    }
}

    
    if (interaction.commandName === 'omikuji') {
        const today = getJstDateString();

        if (data.users[userId].lastOmikujiDate === today) {
            return interaction.reply({
                content: '今日はすでにおみくじを引いています。',
                ephemeral: true
            });
        }

        const member =
            await interaction.guild.members.fetch(userId);
        
        if (!data.detachedColorRoles) {
            data.detachedColorRoles = {};
        }

        const detachedRoleId =
            data.detachedColorRoles[userId];

        if (detachedRoleId) {
            try {
                if (
                    !member.roles.cache.has(
                        detachedRoleId
                    )
                ) {
                    await member.roles.add(
                        detachedRoleId
                    );
                }

                delete data.detachedColorRoles[userId];

            } catch(err) {
                console.error(err);
            }
        }

        const colorMode = interaction.options.getString('mode') || 'single';

        const luckyColor = getRandomColor();
        const luckyColor2 = colorMode === 'gradient' ? getRandomColor() : null;

        const colorText =
            colorMode === 'gradient' && luckyColor2
                ? `グラデーション / ${luckyColor.hex} → ${luckyColor2.hex}`
                : `RGB(${luckyColor.r}, ${luckyColor.g}, ${luckyColor.b}) / ${luckyColor.hex}`;

        const roleId =
            getColorRoleId(data, userId);
        const canChangeColor = Boolean(roleId);

        const points = rollDailyRoulette();

        await addEarnedPointsAndCheckLevel({
            guild: interaction.guild,
            member,
            data,
            amount: points,
            fallbackChannel: interaction.channel
        });

        data.users[userId].lastOmikujiDate = today;
        data.users[userId].lastDailyDate = today;

        addPointLog(data, {
            userId,
            type: 'omikuji',
            amount: points,
            detail: 'daily omikuji'
        });

        saveData(data);

        const result = {
            "運勢運": pickRandom(omikujiData["運勢"]),
            "ガチャ運": pickRandom(omikujiData["ガチャ"]),
            "エリア運": pickRandom(omikujiData["エリア"]),
            "精霊運": pickRandom(omikujiData["精霊"]),
            "絵文字運": pickRandom(omikujiData["絵文字"]),
            "店員運": pickRandom(omikujiData["店員"]),
            "爆発運": pickRandom(omikujiData["爆発"]),
            "遭遇運": pickRandom(omikujiData["遭遇"]),
            "味方運": pickRandom(omikujiData["味方"]),
            "誤字運": pickRandom(omikujiData["誤字"]),
            "ラッキーカラー運": colorText,
            "ポイント運": `${points}pt 獲得`
        };

        const components = [];

        if (canChangeColor) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        colorMode === 'gradient' && luckyColor2
                            ? `omikuji_color_${userId}_${luckyColor.hex.replace('#', '')}_${luckyColor2.hex.replace('#', '')}_${today}_gradient`
                            : `omikuji_color_${userId}_${luckyColor.hex.replace('#', '')}_${today}_single`
                    )
                    .setLabel('ラッキーカラーに変更')
                    .setStyle(ButtonStyle.Primary),

                new ButtonBuilder()
                    .setCustomId(
                        colorMode === 'gradient' && luckyColor2
                            ? `omikuji_savecolor_${userId}_${luckyColor.hex.replace('#', '')}_${luckyColor2.hex.replace('#', '')}_${today}_gradient`
                            : `omikuji_savecolor_${userId}_${luckyColor.hex.replace('#', '')}_${today}_single`
                    )
                    .setLabel('今の色をお気に入り登録して変更')
                    .setStyle(ButtonStyle.Success)
            );

            components.push(row);
        }

        const omikujiDescription =
            Object.entries(result)
                .map(([name, value]) => `**${name}**：${value}`)
                .join('\n');

        const omikujiEmbed = createEmbed(
            '🎴 今日のおみくじ',
            omikujiDescription,
            {
                color: luckyColor.hex
            }
        ).setAuthor({
            name: `${getInteractionDisplayName(interaction)} の今日のおみくじ`,
            iconURL: interaction.user.displayAvatarURL({ size: 128 })
        });

        return interaction.reply({
            content: `<@${userId}>`,
            embeds: [omikujiEmbed],
            components
        });
    }

    if (
        interaction.commandName === 'favlist' ||
        interaction.commandName === 'favset' ||
        interaction.commandName === 'favrem'
    ) {
        const user = data.users[userId];

        if (!user.favoriteColors) user.favoriteColors = [];
        if (user.lastManualColorChange === undefined) user.lastManualColorChange = 0;

        const roleId = getColorRoleId(data, userId);

        if (!roleId) {
            return interaction.reply({
                content: 'カラー設定ロールが登録されていません。',
                ephemeral: true
            });
        }

        if (interaction.commandName === 'favlist') {
            if (user.favoriteColors.length === 0) {
                return interaction.reply({
                    content: '保存済みのお気に入りカラーはありません。',
                    ephemeral: true
                });
            }

            let text = '🎨 お気に入りカラー一覧\n\n';

            user.favoriteColors.forEach((color, index) => {
                text += `${index + 1}. ${color}\n`;
            });

            return interaction.reply({
                content: text,
                ephemeral: true
            });
        }

        if (interaction.commandName === 'favrem') {
            const number = interaction.options.getInteger('number');
            const index = number - 1;

            if (!user.favoriteColors[index]) {
                return interaction.reply({
                    content: `${number}番のお気に入りカラーはありません。`,
                    ephemeral: true
                });
            }

            const removed = user.favoriteColors.splice(index, 1)[0];
            saveData(data);

            return interaction.reply({
                content: `🗑️ ${number}番のカラー ${removed} を削除しました。`,
                ephemeral: true
            });
        }

        if (interaction.commandName === 'favset') {
            const number = interaction.options.getInteger('number');
            const index = number - 1;
            const color = user.favoriteColors[index];

            if (!color) {
                return interaction.reply({
                    content: `${number}番のお気に入りカラーはありません。`,
                    ephemeral: true
                });
            }

            const now = Date.now();
            const cooldown = 24 * 60 * 60 * 1000;

            if (
                user.lastManualColorChange &&
                now - user.lastManualColorChange < cooldown
            ) {
                const remain = cooldown - (now - user.lastManualColorChange);
                const remainHours = Math.ceil(remain / (60 * 60 * 1000));

                return interaction.reply({
                    content:
                        `お気に入りカラー変更は24時間に1回です。\n` +
                        `あと約${remainHours}時間待ってください。`,
                    ephemeral: true
                });
            }

            try {
                const role = await interaction.guild.roles.fetch(roleId);
                await role.setColor(color);

                user.lastManualColorChange = now;
                saveData(data);

                return interaction.reply({
                    content: `🎨 お気に入りカラー ${color} に変更しました。`,
                    ephemeral: true
                });
            } catch (err) {
                console.error(err);

                return interaction.reply({
                    content: 'カラー変更に失敗しました。Botのロール位置や権限を確認してください。',
                    ephemeral: true
                });
            }
        }
    }

    if (interaction.commandName === 'log') {
        try {
            if (!data.logs) data.logs = [];

            if (data.logs.length === 0) {
                return interaction.reply({
                    content: 'ログはまだありません。',
                    ephemeral: true
                });
            }

            const recentLogs = data.logs.slice(-20).reverse();

            let text = '📜 直近20件のポイントログ\n\n';

            for (const log of recentLogs) {
                const amount = Number(log.amount || 0);
                const sign = amount >= 0 ? '+' : '';
                const userText = log.userId ? `<@${log.userId}>` : '不明ユーザー';

                if (log.hourlyKey) {
                    text +=
                        `🕒 ${log.detail || log.time || '時間不明'} ` +
                        `${userText} ${sign}${amount.toFixed(1)}pt\n`;
                } else {
                    text +=
                        `${log.type || 'unknown'} ` +
                        `${userText} ${sign}${amount.toFixed(1)}pt`;

                    if (log.detail) {
                        text += ` (${log.detail})`;
                    }

                    text += '\n';
                }
            }

            if (text.length > 1900) {
                text = text.slice(0, 1900) + '\n...';
            }

            return interaction.reply({
                content: text,
                ephemeral: true
            });

        } catch (err) {
            console.error(err);

            return interaction.reply({
                content: 'ログ表示中にエラーが発生しました。',
                ephemeral: true
            });
        }
    }

    if (interaction.commandName === 'stats') {
        const user = data.users[userId];

        const voiceMinutesTotal = user.voiceMinutesTotal || 0;
        const hours = Math.floor(voiceMinutesTotal / 60);
        const minutes = voiceMinutesTotal % 60;

        return interaction.reply({
            content:
                `💰 所持pt: ${user.points.toFixed(1)}pt\n` +
                `🎫 ガチャチケット: ${user.tickets || 0}枚\n\n` +
                `⭐ Lv.${user.level}\n` +
                `📈 Lv用累計pt: ${user.levelPoints.toFixed(1)}pt\n\n` +
                `🎤 作業時間: ${hours}時間${minutes}分\n` +
                `👍 リアクション数: ${user.reactionCount || 0}回\n` +
                `💬 メッセージ数: ${user.messageCount || 0}通\n` +
                `💥 爆破された回数: ${user.explosionCount || 0}回\n` +
                `🎲 1/2^n自己ベスト: ${user.halfBest || 0}連続`
        });
    }

    if (interaction.commandName === 'rank') {
        const type = interaction.options.getString('type') || 'points';

        const labels = {
            points: '所持ポイント',
            level: 'レベル',
            voice: '作業時間',
            reaction: 'リアクション数',
            message: 'メッセージ数',
            explosion: '爆発回数',
            half: '1/2^n 連続成功数'
        };

        const getValue = (userData) => {
            if (type === 'points') return userData.points || 0;
            if (type === 'level') return userData.level || 0;
            if (type === 'voice') return userData.voiceMinutesTotal || 0;
            if (type === 'reaction') return userData.reactionCount || 0;
            if (type === 'message') return userData.messageCount || 0;
            if (type === 'explosion') return userData.explosionCount || 0;
            if (type === 'half') return userData.halfBest || 0;
            return userData.points || 0;
        };

        const formatValue = (value, userData) => {
            if (type === 'points') return `${value.toFixed(1)}pt`;
            if (type === 'level') {
                return `Lv.${userData.level || 0} / Lv用pt ${Number(userData.levelPoints || 0).toFixed(1)}pt`;
            }
            if (type === 'voice') {
                const hours = Math.floor(value / 60);
                const minutes = value % 60;
                return `${hours}時間${minutes}分`;
            }
            if (type === 'reaction') return `${value}回`;
            if (type === 'message') return `${value}通`;
            if (type === 'explosion') return `${value}回`;
            if (type === 'half') return `${value}連続`;
            return String(value);
        };

        const ranking =
            Object.entries(data.users)
                .sort((a, b) => getValue(b[1]) - getValue(a[1]))
                .slice(0, 10);

        let text = `🏆 ${labels[type]}ランキング\n\n`;

        for (let i = 0; i < ranking.length; i++) {
            const rankedUserId = ranking[i][0];
            const rankedUserData = ranking[i][1];
            const displayName = await getDisplayName(interaction.guild, rankedUserId);
            const value = getValue(rankedUserData);

            text +=
                `${i + 1}. ${displayName} - ` +
                `${formatValue(value, rankedUserData)}\n`;
        }

        return interaction.reply({
            content: text
        });
    }

    if (interaction.commandName === 'i-shop') {
        let text = '🛒 SHOP\n\n';

        for (const [name, item] of Object.entries(shop)) {
            if (item.type === "ticket") {
                text += `${name} : ${item.price}pt / ${item.amount || 1}枚\n`;
            } else {
                text += `${name} : ${item.price}pt\n`;
            }
        }

        return interaction.reply({ content: text });
    }

    if (interaction.commandName === 'i-buy') {
        const itemName =
            interaction.options.getString('item');

        const item = shop[itemName];

        if (!item) {
            return interaction.reply({
                content: '存在しない商品です。',
                ephemeral: true
            });
        }

        if (data.users[userId].points < item.price) {
            return interaction.reply({
                content: 'ポイント不足です。',
                ephemeral: true
            });
        }

        if (item.type === "ticket") {
            data.users[userId].points -= item.price;
            data.users[userId].tickets += item.amount || 1;

            addPointLog(data, {
                userId,
                type: 'buy-ticket',
                amount: -item.price,
                detail: `${item.amount || 1} ticket`
            });

            saveData(data);

            return interaction.reply({
                content:
                    `🎫 ガチャチケットを ${item.amount || 1}枚 購入しました。\n` +
                    `現在の所持チケット: ${data.users[userId].tickets}枚`
            });
        }

        const member =
            await interaction.guild.members.fetch(userId);

        await member.roles.add(item.roleId);

        data.users[userId].points -= item.price;

        if (settings.DISPLAY_ROLES && settings.DISPLAY_ROLES[itemName]) {
            if (!data.users[userId].purchasedDisplayRoles) {
                data.users[userId].purchasedDisplayRoles = [];
            }

            if (!data.users[userId].purchasedDisplayRoles.includes(itemName)) {
                data.users[userId].purchasedDisplayRoles.push(itemName);
            }
        }

        addPointLog(data, {
            userId,
            type: 'buy',
            amount: -item.price,
            detail: itemName
        });

        saveData(data);

        if (itemName === 'admin12h') {
            setTimeout(async () => {
                try {
                    await member.roles.remove(item.roleId);
                } catch {}
            }, 1 * 60 * 60 * 1000);
        }

        return interaction.reply({
            content: `購入成功！ <@&${item.roleId}> を購入しました。`
        });
    }

    if (interaction.commandName === 'g-gacha') {
        if (!data.users[userId].tickets || data.users[userId].tickets <= 0) {
            return interaction.reply({
                content:
                    'ガチャチケットがありません。\n' +
                    '/i-shop から gachaTicket を購入してください。',
                ephemeral: true
            });
        }

        data.users[userId].tickets -= 1;

        addPointLog(data, {
            userId,
            type: 'gacha-ticket',
            amount: 0,
            detail: 'used 1 ticket'
        });

        const roll = Math.random();

        const member =
            await interaction.guild.members.fetch(userId);

        if (roll <= gacha.goldenChance) {
            await member.roles.add(gacha.goldenRole);

            saveData(data);

            return interaction.reply({
                content: '🌟 GOLDEN ROLE獲得！'
            });
        }

        if (roll <= gacha.normalChance + gacha.goldenChance) {
            const roleId =
                gacha.normalRoles[
                    Math.floor(Math.random() * gacha.normalRoles.length)
                ];

            await member.roles.add(roleId);

            saveData(data);

            return interaction.reply({
                content: '🎉 ロール獲得！'
            });
        }

        saveData(data);

        return interaction.reply({
            content: '😢 ハズレ！'
        });
    }

    if (interaction.commandName === 'm-addt') {
        if (
            !interaction.member.permissions.has(
                PermissionsBitField.Flags.Administrator
            )
        ) {
            return interaction.reply({
                content: '管理者専用です。',
                ephemeral: true
            });
        }

        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');

        if (!amount || amount <= 0) {
            return interaction.reply({
                content: '1以上の枚数を指定してください。',
                ephemeral: true
            });
        }

        ensureUser(data, target.id);

        data.users[target.id].tickets += amount;

        addPointLog(data, {
            userId: target.id,
            type: 'addticket',
            amount: 0,
            detail: `+${amount} ticket by ${userId}`
        });

        saveData(data);

        return interaction.reply({
            content: `<@${target.id}> にガチャチケットを ${amount}枚 追加しました。`
        });
    }

    if (interaction.commandName === 'p-give') {
        const target =
            interaction.options.getUser('user');

        const amount =
            interaction.options.getNumber('amount');

        if (target.bot) {
            return interaction.reply({
                content: 'Botには譲渡できません。',
                ephemeral: true
            });
        }

        if (target.id === userId) {
            return interaction.reply({
                content: '自分には譲渡できません。',
                ephemeral: true
            });
        }

        if (!amount || amount <= 0) {
            return interaction.reply({
                content: '1より大きいポイントを指定してください。',
                ephemeral: true
            });
        }

        ensureUser(data, target.id);
        ensureUser(data, ADMIN_USER_ID);

        if (data.users[userId].points < amount) {
            return interaction.reply({
                content: 'ポイント不足です。',
                ephemeral: true
            });
        }

        const fee = amount * settings.GIVE_FEE_RATE;
        const received = amount - fee;

        data.users[userId].points -= amount;

        addPoints(data, target.id, received, { addToLevel: false });
        addPoints(data, ADMIN_USER_ID, fee, { addToLevel: false });

        addPointLog(data, {
            userId,
            type: 'give',
            amount: -amount,
            detail: `to ${target.id}`
        });

        addPointLog(data, {
            userId: target.id,
            type: 'receive',
            amount: received,
            detail: `from ${userId}`
        });

        addPointLog(data, {
            userId: ADMIN_USER_ID,
            type: 'fee',
            amount: fee,
            detail: `from ${userId}`
        });

        saveData(data);

        return interaction.reply({
            content:
                `<@${target.id}> に ${received.toFixed(1)}pt 譲渡しました。\n` +
                `手数料 ${fee.toFixed(1)}pt は <@${ADMIN_USER_ID}> に送られました。`
        });
    }

    if (interaction.commandName === 'm-addp') {
        if (
            !interaction.member.permissions.has(
                PermissionsBitField.Flags.Administrator
            )
        ) {
            return interaction.reply({
                content: '管理者専用です。',
                ephemeral: true
            });
        }

        const target = interaction.options.getUser('user');
        const amount = interaction.options.getNumber('amount');

        if (!amount || amount <= 0) {
            return interaction.reply({
                content: '1より大きい数値を指定してください。',
                ephemeral: true
            });
        }

        ensureUser(data, target.id);

        addPoints(data, target.id, amount, { addToLevel: false });

        addPointLog(data, {
            userId: target.id,
            type: 'addpoint',
            amount,
            detail: `by ${userId}`
        });

        saveData(data);

        return interaction.reply({
            content: `<@${target.id}> に ${amount}pt を追加しました。`
        });
    }

    if (interaction.commandName === 'm-roleap') {
        if (
            !interaction.member.permissions.has(
                PermissionsBitField.Flags.Administrator
            )
        ) {
            return interaction.reply({
                content: '管理者専用です。',
                ephemeral: true
            });
        }

        const role = interaction.options.getRole('role');
        const amount = interaction.options.getNumber('amount');
        const addToLevel = interaction.options.getBoolean('level');

        if (!amount || amount <= 0) {
            return interaction.reply({
                content: '1より大きい数値を指定してください。',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });
        await interaction.guild.members.fetch();

        const members = interaction.guild.members.cache.filter(member =>
            !member.user.bot && member.roles.cache.has(role.id)
        );

        if (members.size === 0) {
            return interaction.editReply({
                content: '対象ロールを持つメンバーがいません。'
            });
        }

        let successCount = 0;
        let levelUpCount = 0;

        for (const member of members.values()) {
            ensureUser(data, member.id);

            addPoints(data, member.id, amount, { addToLevel });

            addPointLog(data, {
                userId: member.id,
                type: 'role-addpoint',
                amount,
                detail: `role:${role.id} level:${addToLevel}`
            });

            if (addToLevel) {
                const result = await checkLevelUp(member, data.users[member.id]);

                if (result.leveledUp) {
                    levelUpCount += 1;
                    await announceLevelUp(interaction.guild, member, result, interaction.channel);
                }
            }

            successCount += 1;
        }

        saveData(data);

        return interaction.editReply({
            content:
                `<@&${role.id}> のメンバー ${successCount}人に ${amount}pt を付与しました。\n` +
                `Lv用ポイント加算: ${addToLevel ? 'あり' : 'なし'}\n` +
                `レベルアップ人数: ${levelUpCount}人`
        });
    }

    if (interaction.commandName === 'r-disp') {
        const selected = interaction.options.getString('role');

        if (!settings.DISPLAY_ROLES) {
            return interaction.reply({
                content: '表示ロール設定がありません。',
                ephemeral: true
            });
        }

        const isSpecialOption = selected === 'none' || selected === 'all';

        if (!isSpecialOption && !(selected in settings.DISPLAY_ROLES)) {
            return interaction.reply({
                content: '存在しない表示ロールです。',
                ephemeral: true
            });
        }

        const member =
            await interaction.guild.members.fetch(userId);

        if (!data.users[userId].purchasedDisplayRoles) {
            data.users[userId].purchasedDisplayRoles = [];
        }

        const purchasedDisplayRoles = data.users[userId].purchasedDisplayRoles;

        const displayRoleIds =
            Object.values(settings.DISPLAY_ROLES)
                .filter(roleId => roleId);

        try {
            for (const roleId of displayRoleIds) {
                if (member.roles.cache.has(roleId)) {
                    await member.roles.remove(roleId);
                }
            }

            if (selected === 'none') {
                data.users[userId].displayRole = 'none';
                saveData(data);

                return interaction.reply({
                    content: '表示ロールをすべて解除しました。',
                    ephemeral: true
                });
            }

            if (selected === 'all') {
                const addRoleNames = purchasedDisplayRoles
                    .filter(name => settings.DISPLAY_ROLES[name]);

                if (addRoleNames.length === 0) {
                    saveData(data);

                    return interaction.reply({
                        content: '購入済みの表示ロールがありません。',
                        ephemeral: true
                    });
                }

                for (const roleName of addRoleNames) {
                    const roleId = settings.DISPLAY_ROLES[roleName];

                    if (roleId) {
                        await member.roles.add(roleId);
                    }
                }

                data.users[userId].displayRole = 'all';

                saveData(data);

                return interaction.reply({
                    content:
                        `購入済みの表示ロールをすべて付与しました。\n` +
                        addRoleNames.map(name => `・${name}`).join('\n'),
                    ephemeral: true
                });
            }

            if (!purchasedDisplayRoles.includes(selected)) {
                saveData(data);

                return interaction.reply({
                    content:
                        `この表示ロール「${selected}」はまだ購入していません。\n` +
                        `/i-shop で購入してから使用してください。`,
                    ephemeral: true
                });
            }

            const newRoleId = settings.DISPLAY_ROLES[selected];

            if (newRoleId) {
                await member.roles.add(newRoleId);
            }

            data.users[userId].displayRole = selected;

            saveData(data);

            return interaction.reply({
                content: `表示ロールを ${selected} に変更しました。`,
                ephemeral: true
            });

        } catch (err) {
            console.error(err);

            return interaction.reply({
                content:
                    '表示ロールの変更に失敗しました。Botのロール位置や権限を確認してください。',
                ephemeral: true
            });
        }
    }

    if (interaction.commandName === 'workcheck') {
        data.users[userId].lastWorkCheck = Date.now();
        data.users[userId].vcSessionMinutes = 0;

        saveData(data);

        return interaction.reply({
            content: 'VC減衰をリセットしました。',
            ephemeral: true
        });
    }

    if (interaction.commandName === 'g-double') {
        const amount = interaction.options.getNumber('amount');

        if (!amount || amount <= 0) {
            return interaction.reply({
                content: '1より大きいポイントを指定してください。',
                ephemeral: true
            });
        }

        if (data.users[userId].points < amount) {
            return interaction.reply({
                content: 'ポイント不足です。',
                ephemeral: true
            });
        }

        data.users[userId].points -= amount;

        data.doubleUps[userId] = {
            bet: amount,
            current: amount,
            active: true
        };

        addPointLog(data, {
            userId,
            type: 'doubleup-start',
            amount: -amount,
            detail: 'doubleup bet'
        });

        saveData(data);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`doubleup_A_${userId}`)
                .setLabel('A')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId(`doubleup_B_${userId}`)
                .setLabel('B')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId(`doubleup_stop_${userId}`)
                .setLabel('終了して受け取る')
                .setStyle(ButtonStyle.Success)
        );

        return interaction.reply({
            content:
                `🎲 ダブルアップ開始！\n` +
                `現在の山分: ${amount}pt\n` +
                `AかBを選んでください。`,
            components: [row]
        });
    }

    if (interaction.commandName === 'db-start') {
        const title = interaction.options.getString('title');

        if (data.users[userId].points < 500) {
            return interaction.reply({
                content: 'ダービー開始には500pt必要です。',
                ephemeral: true
            });
        }

        data.users[userId].points -= 500;

        const derbyId = Date.now().toString();

        data.derbies[derbyId] = {
            id: derbyId,
            title,
            ownerId: userId,
            bank: 500,
            entries: {
                [userId]: 500
            },
            status: 'open',
            createdAt: new Date().toISOString()
        };

        addPointLog(data, {
            userId,
            type: 'derby-start',
            amount: -500,
            detail: derbyId
        });

        saveData(data);

        return interaction.reply({
            content:
                `🏇 ダービーを開始しました！\n` +
                `ID: ${derbyId}\n` +
                `タイトル: ${title}\n` +
                `/db-join id:${derbyId} amount:ポイント で参加できます。`
        });
    }

    if (interaction.commandName === 'db-list') {
        const openDerbies =
            Object.values(data.derbies)
                .filter(derby => derby.status === 'open');

        if (openDerbies.length === 0) {
            return interaction.reply({
                content: '開催中のダービーはありません。',
                ephemeral: true
            });
        }

        let text = '🏇 開催中のダービー一覧\n\n';

        for (const derby of openDerbies) {
            text +=
                `ID: ${derby.id}\n` +
                `タイトル: ${derby.title}\n` +
                `主催者: <@${derby.ownerId}>\n` +
                `バンク: ${Number(derby.bank).toFixed(1)}pt\n\n`;
        }

        return interaction.reply({
            content: text
        });
    }

    if (interaction.commandName === 'db-join') {
        const derbyId = interaction.options.getString('id');
        const amount = interaction.options.getNumber('amount');

        if (!amount || amount <= 0) {
            return interaction.reply({
                content: '1より大きいポイントを指定してください。',
                ephemeral: true
            });
        }

        if (!data.derbies[derbyId]) {
            return interaction.reply({
                content: 'そのダービーは存在しません。',
                ephemeral: true
            });
        }

        const derby = data.derbies[derbyId];

        if (derby.status !== 'open') {
            return interaction.reply({
                content: 'このダービーは参加受付中ではありません。',
                ephemeral: true
            });
        }

        if (data.users[userId].points < amount) {
            return interaction.reply({
                content: 'ポイント不足です。',
                ephemeral: true
            });
        }

        data.users[userId].points -= amount;

        if (!derby.entries[userId]) {
            derby.entries[userId] = 0;
        }

        derby.entries[userId] += amount;
        derby.bank += amount;

        addPointLog(data, {
            userId,
            type: 'derby-join',
            amount: -amount,
            detail: derbyId
        });

        saveData(data);

        return interaction.reply({
            content:
                `🏇 ${derby.title} に ${amount}pt 賭けました。\n` +
                `現在のバンク: ${Number(derby.bank).toFixed(1)}pt`
        });
    }

    if (interaction.commandName === 'db-result') {
        const derbyId = interaction.options.getString('id');
        const winnersRaw = interaction.options.getString('winners');

        if (!data.derbies[derbyId]) {
            return interaction.reply({
                content: 'そのダービーは存在しません。',
                ephemeral: true
            });
        }

        const derby = data.derbies[derbyId];

        const isAdmin =
            interaction.member.permissions.has(
                PermissionsBitField.Flags.Administrator
            );

        if (userId !== derby.ownerId && !isAdmin) {
            return interaction.reply({
                content: '結果を確定できるのは主催者または管理者のみです。',
                ephemeral: true
            });
        }

        if (derby.status !== 'open') {
            return interaction.reply({
                content: 'このダービーはすでに終了しています。',
                ephemeral: true
            });
        }

        ensureUser(data, derby.ownerId);

        if (winnersRaw.toLowerCase() === 'none') {
            data.users[derby.ownerId].points += derby.bank;

            addPointLog(data, {
                userId: derby.ownerId,
                type: 'derby-no-winner',
                amount: derby.bank,
                detail: derbyId
            });

            derby.status = 'closed';

            saveData(data);

            return interaction.reply({
                content:
                    `🏇 ダービー終了！\n` +
                    `勝者なしのため、バンク ${Number(derby.bank).toFixed(1)}pt は主催者 <@${derby.ownerId}> に渡されました。`
            });
        }

        const winnerIds =
            [...winnersRaw.matchAll(/<@!?(\d+)>/g)]
                .map(match => match[1]);

        if (winnerIds.length === 0) {
            return interaction.reply({
                content: '勝者はメンションで指定してください。勝者なしなら none と入力してください。',
                ephemeral: true
            });
        }

        const fee = derby.bank * 0.05;
        const prizePool = derby.bank - fee;
        const prizePerWinner = prizePool / winnerIds.length;

        data.users[derby.ownerId].points += fee;

        addPointLog(data, {
            userId: derby.ownerId,
            type: 'derby-fee',
            amount: fee,
            detail: derbyId
        });

        for (const winnerId of winnerIds) {
            ensureUser(data, winnerId);

            data.users[winnerId].points += prizePerWinner;

            addPointLog(data, {
                userId: winnerId,
                type: 'derby-win',
                amount: prizePerWinner,
                detail: derbyId
            });
        }

        derby.status = 'closed';

        saveData(data);

        return interaction.reply({
            content:
                `🏇 ダービー結果確定！\n` +
                `バンク: ${Number(derby.bank).toFixed(1)}pt\n` +
                `手数料: ${fee.toFixed(1)}pt → <@${derby.ownerId}>\n` +
                `賞金: ${prizePerWinner.toFixed(1)}pt × ${winnerIds.length}人\n` +
                `勝者: ${winnerIds.map(id => `<@${id}>`).join(' ')}`
        });
    }


    if (interaction.commandName === 'm-joinvote') {
        if (
            !interaction.member.permissions.has(
                PermissionsBitField.Flags.Administrator
            )
        ) {
            return interaction.reply({
                content: '管理者専用です。',
                ephemeral: true
            });
        }

        const target = interaction.options.getUser('user');
        const role = interaction.options.getRole('role');
        const reason = interaction.options.getString('reason') || '';

        if (target.bot) {
            return interaction.reply({
                content: 'Botは参加許可投票の対象にできません。',
                ephemeral: true
            });
        }

        await interaction.guild.members.fetch();

        const targetMember =
            await interaction.guild.members.fetch(target.id);

        if (targetMember.roles.cache.has(role.id)) {
            return interaction.reply({
                content: `<@${target.id}> はすでに <@&${role.id}> を持っています。`,
                ephemeral: true
            });
        }

        const voters = interaction.guild.members.cache.filter(member =>
            !member.user.bot &&
            member.roles.cache.has(role.id) &&
            member.id !== target.id
        );

        const totalVoters = voters.size;

        if (totalVoters <= 0) {
            return interaction.reply({
                content: '投票対象ロールを持つメンバーがいません。',
                ephemeral: true
            });
        }

        if (!data.joinVotes) data.joinVotes = {};

        const voteId = createShortId('jv');

        data.joinVotes[voteId] = {
            id: voteId,
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            messageId: null,
            creatorId: userId,
            targetUserId: target.id,
            roleId: role.id,
            reason,
            totalVoters,
            approveThreshold: Math.ceil(totalVoters * 2 / 3),
            denyThreshold: Math.ceil(totalVoters / 3),
            approveCount: 0,
            denyCount: 0,
            voters: {},
            closed: false,
            result: null,
            createdAt: new Date().toISOString()
        };

        const message = await interaction.reply({
            embeds: [buildJoinVoteEmbed(data.joinVotes[voteId])],
            components: [buildJoinVoteRow(voteId)],
            fetchReply: true
        });

        data.joinVotes[voteId].messageId = message.id;

        saveData(data);

        return;
    }

    if (interaction.commandName === 'anonpoll') {
        const title = interaction.options.getString('title');
        const endInput = interaction.options.getString('end');
        const parsedEnd = parseAnonPollEndTime(endInput);

        if (!parsedEnd.ok) {
            return interaction.reply({
                content: parsedEnd.error,
                ephemeral: true
            });
        }

        if (parsedEnd.endAt && new Date(parsedEnd.endAt).getTime() <= Date.now()) {
            return interaction.reply({
                content: '終了時間は現在より後の時刻を指定してください。',
                ephemeral: true
            });
        }

        const choices = [];

        for (let i = 1; i <= 10; i++) {
            const choice = interaction.options.getString(`choice${i}`);

            if (choice && choice.trim()) {
                choices.push(choice.trim());
            }
        }

        const uniqueChoices =
            choices.filter((choice, index) => choices.indexOf(choice) === index);

        if (uniqueChoices.length < 2) {
            return interaction.reply({
                content: '選択肢は2つ以上必要です。',
                ephemeral: true
            });
        }

        if (!data.anonPolls) data.anonPolls = {};

        const pollId = createShortId('ap');

        data.anonPolls[pollId] = {
            id: pollId,
            title: title.slice(0, 256),
            choices: uniqueChoices,
            counts: uniqueChoices.map(() => 0),
            voters: {},
            creatorId: userId,
            guildId: interaction.guild.id,
            channelId: interaction.channel.id,
            messageId: null,
            endAt: parsedEnd.endAt,
            closed: false,
            closeReason: null,
            closedAt: null,
            createdAt: new Date().toISOString()
        };

        const message = await interaction.reply({
            embeds: [buildAnonPollEmbed(data.anonPolls[pollId])],
            components: buildAnonPollRows(pollId, data.anonPolls[pollId]),
            fetchReply: true
        });

        data.anonPolls[pollId].messageId = message.id;

        saveData(data);

        return;
    }

    if (interaction.commandName === 'g-half') {
        if (!data.halfGames) data.halfGames = {};

        if (data.halfGames[userId]?.active) {
            return interaction.reply({
                content: 'すでに進行中の1/2^nゲームがあります。',
                ephemeral: true
            });
        }

        data.halfGames[userId] = {
            active: true,
            current: 0,
            startedAt: new Date().toISOString()
        };

        saveData(data);

        return interaction.reply({
            content:
                `🎲 1/2^nゲーム開始！\n` +
                `AかBを選んでください。\n` +
                `外すまで連続成功数を伸ばせます。`,
            components: [buildHalfGameRow(userId)]
        });
    }

    if (interaction.commandName === 'mutebomb') {
        const hasMuteBombRole =
            settings.MUTEBOMB_ALLOWED_ROLE_ID &&
            interaction.member.roles.cache.has(
                settings.MUTEBOMB_ALLOWED_ROLE_ID
            );

        if (
            !interaction.member.permissions.has(
                PermissionsBitField.Flags.Administrator
            ) &&
            !hasMuteBombRole
        ) {
            return interaction.reply({
                content: '権限がありません',
                ephemeral: true
            });
        }

        const channelId = String(interaction.channel.id);

        if (data.mutedBombChannels.map(String).includes(channelId)) {
            data.mutedBombChannels =
            data.mutedBombChannels.filter(id => String(id) !== channelId);

            saveData(data);

            return interaction.reply({
                content: '爆弾を有効化しました。'
            });
}

        data.mutedBombChannels.push(channelId);

            saveData(data);

        return interaction.reply({
            content: '爆弾を無効化しました。'
        });
    }
});

client.login(process.env.TOKEN);