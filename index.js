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
    ButtonStyle
} = require('discord.js');

const {
    initDataStore,
    loadData,
    saveData,
    ensureUser,
    addPoints,
    addPointLog
} = require('./utils/dataManager');

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

const explosionGif =
    "https://tenor.com/view/jpexplosion-gif-5562858";

const timeoutList = [5, 10, 15, 30, 60];

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

const commands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Botの応答確認'),

    new SlashCommandBuilder()
        .setName('balance')
        .setDescription('ポイント確認'),

    new SlashCommandBuilder()
        .setName('rank')
        .setDescription('ランキング'),

    new SlashCommandBuilder()
        .setName('shop')
        .setDescription('ショップ'),

    new SlashCommandBuilder()
        .setName('buy')
        .setDescription('アイテム購入')
        .addStringOption(option =>
            option
                .setName('item')
                .setDescription('商品名')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('gacha')
        .setDescription('ガチャ'),

    new SlashCommandBuilder()
        .setName('addticket')
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
        .setName('daily')
        .setDescription('1日1回無料のデイリールーレット'),

    new SlashCommandBuilder()
        .setName('give')
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
        .setName('addpoint')
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
        .setName('displayrole')
        .setDescription('表示用ロールを付け替え')
        .addStringOption(option =>
            option
                .setName('role')
                .setDescription('表示するロール名。noneで解除')
                .setRequired(true)
                .addChoices(
                    { name: 'なし', value: 'none' },
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
        .setName('doubleup')
        .setDescription('ポイントを賭けてダブルアップ')
        .addNumberOption(option =>
            option
                .setName('amount')
                .setDescription('賭けるポイント')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('derby_start')
        .setDescription('500ptを使ってダービーを開始')
        .addStringOption(option =>
            option
                .setName('title')
                .setDescription('ダービー名')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('derby_list')
        .setDescription('開催中のダービー一覧'),

    new SlashCommandBuilder()
        .setName('join')
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
        .setName('result')
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
        .setName('setcolor')
        .setDescription('ロールカラー変更'),

    new SlashCommandBuilder()
        .setName('mutebomb')
        .setDescription('このチャンネルの爆弾ON/OFF')
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
        if (userData.lastDailyDate !== today) {
            mentions.push(`<@${targetUserId}>`);
        }
    }

    if (mentions.length > 0) {
        for (let i = 0; i < mentions.length; i += 30) {
            const chunk = mentions.slice(i, i + 30);

            await channel.send(
                `🎡 デイリールーレットがまだです！ ${chunk.join(' ')}\n` +
                `/daily で今日の無料ポイントを受け取れます。`
            );
        }
    }

    data.dailyReminderSentDate = today;
    saveData(data);
}

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!settings.AUTO_SERVER_MUTE_ON_JOIN) return;

    if (!oldState.channel && newState.channel) {
        try {
            if (newState.member.user.bot) return;

            await newState.setMute(
                true,
                'VC入室時の自動サーバーミュート'
            );
        } catch (err) {
            console.error('自動ミュート失敗:', err);
        }
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const data = loadData();

    ensureUser(data, message.author.id);

    const member =
        await message.guild.members.fetch(message.author.id);

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

    if (!data.mutedBombChannels.includes(message.channel.id)) {
        if (Math.random() <= settings.BOMB_CHANCE) {
            try {
                const seconds =
                    timeoutList[Math.floor(Math.random() * timeoutList.length)];

                await message.channel.send(
                    `${explosionGif}\n` +
                    `<@${message.author.id}>じゃ！ \n` +
                    `${seconds}.`
                );

                await member.timeout(seconds * 1000, '爆弾');
            } catch (err) {
                console.error(err);
            }
        }
    }

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
    if (interaction.isButton()) {
        const data = loadData();

        const parts = interaction.customId.split('_');

        if (parts[0] !== 'doubleup') return;

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

    if (!interaction.isChatInputCommand()) return;

    const data = loadData();
    const userId = interaction.user.id;

    ensureUser(data, userId);

    if (interaction.commandName === 'ping') {
        return interaction.reply({
            content: `🏓 Pong! ${client.ws.ping}ms`
        });
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

    if (interaction.commandName === 'balance') {
        const user = data.users[userId];

        return interaction.reply({
            content:
                `💰 所持pt: ${user.points.toFixed(1)}pt\n` +
                `🎫 ガチャチケット: ${user.tickets || 0}枚\n` +
                `📈 レベル用累計pt: ${user.levelPoints.toFixed(1)}pt\n` +
                `Lv.${user.level}`
        });
    }

    if (interaction.commandName === 'rank') {
        const ranking =
            Object.entries(data.users)
                .sort((a, b) => b[1].points - a[1].points)
                .slice(0, 10);

        let text = '🏆 所持ポイントランキング\n\n';

        for (let i = 0; i < ranking.length; i++) {
            const user = await client.users.fetch(ranking[i][0]);

            text +=
                `${i + 1}. ${user.username} - ` +
                `${ranking[i][1].points.toFixed(1)}pt\n`;
        }

        return interaction.reply({ content: text });
    }

    if (interaction.commandName === 'shop') {
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

    if (interaction.commandName === 'buy') {
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
            content: '購入成功！'
        });
    }

    if (interaction.commandName === 'gacha') {
        if (!data.users[userId].tickets || data.users[userId].tickets <= 0) {
            return interaction.reply({
                content:
                    'ガチャチケットがありません。\n' +
                    '/shop から gachaTicket を購入してください。',
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

    if (interaction.commandName === 'addticket') {
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

    if (interaction.commandName === 'daily') {
        const today = getJstDateString();

        if (data.users[userId].lastDailyDate === today) {
            return interaction.reply({
                content: '今日はすでにデイリールーレットを使用済みです。',
                ephemeral: true
            });
        }

        const points = rollDailyRoulette();

        const member =
            await interaction.guild.members.fetch(userId);

        await addEarnedPointsAndCheckLevel({
            guild: interaction.guild,
            member,
            data,
            amount: points,
            fallbackChannel: interaction.channel
        });

        data.users[userId].lastDailyDate = today;

        addPointLog(data, {
            userId,
            type: 'daily',
            amount: points,
            detail: 'daily roulette'
        });

        saveData(data);

        return interaction.reply({
            content: `デイリールーレット結果: ${points}pt 獲得！`
        });
    }

    if (interaction.commandName === 'give') {
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
                `<${target.id}> に ${received.toFixed(1)}pt 譲渡しました。\n` +
                `手数料 ${fee.toFixed(1)}pt は <@${ADMIN_USER_ID}> に送られました。`
        });
    }

    if (interaction.commandName === 'addpoint') {
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

    if (interaction.commandName === 'displayrole') {
        const selected = interaction.options.getString('role');

        if (!settings.DISPLAY_ROLES) {
            return interaction.reply({
                content: '表示ロール設定がありません。',
                ephemeral: true
            });
        }

        if (!(selected in settings.DISPLAY_ROLES)) {
            return interaction.reply({
                content: '存在しない表示ロールです。',
                ephemeral: true
            });
        }

        const member =
            await interaction.guild.members.fetch(userId);

        const displayRoleIds =
            Object.values(settings.DISPLAY_ROLES)
                .filter(roleId => roleId);

        try {
            for (const roleId of displayRoleIds) {
                if (member.roles.cache.has(roleId)) {
                    await member.roles.remove(roleId);
                }
            }

            const newRoleId = settings.DISPLAY_ROLES[selected];

            if (newRoleId) {
                await member.roles.add(newRoleId);
            }

            data.users[userId].displayRole = selected;

            saveData(data);

            if (selected === 'none') {
                return interaction.reply({
                    content: '表示ロールを解除しました。',
                    ephemeral: true
                });
            }

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

    if (interaction.commandName === 'doubleup') {
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

    if (interaction.commandName === 'derby_start') {
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
                `/join id:${derbyId} amount:ポイント で参加できます。`
        });
    }

    if (interaction.commandName === 'derby_list') {
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

    if (interaction.commandName === 'join') {
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

    if (interaction.commandName === 'result') {
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

    if (interaction.commandName === 'setcolor') {
        const roleId = ROLE_MAP[userId];

        if (!roleId) {
            return interaction.reply({
                content: '対応ロールがありません。',
                ephemeral: true
            });
        }

        const now = Date.now();
        const cooldown = 24 * 60 * 60 * 1000;

        const last = data.colorCooldowns[userId];

        if (last && now - last < cooldown) {
            return interaction.reply({
                content: '1日1回までです。',
                ephemeral: true
            });
        }

        const r = Math.floor(Math.random() * 256);
        const g = Math.floor(Math.random() * 256);
        const b = Math.floor(Math.random() * 256);

        const hex =
            '#' +
            r.toString(16).padStart(2, '0') +
            g.toString(16).padStart(2, '0') +
            b.toString(16).padStart(2, '0');

        try {
            const role =
                await interaction.guild.roles.fetch(roleId);

            await role.setColor(hex);

            data.colorCooldowns[userId] = now;

            saveData(data);

            return interaction.reply({
                content:
                    `変更完了！\n` +
                    `RGB(${r}, ${g}, ${b})\n` +
                    `${hex}`
            });
        } catch (err) {
            console.error(err);

            return interaction.reply({
                content: '変更失敗。',
                ephemeral: true
            });
        }
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

        const channelId = interaction.channel.id;

        if (data.mutedBombChannels.includes(channelId)) {
            data.mutedBombChannels =
                data.mutedBombChannels.filter(id => id !== channelId);

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