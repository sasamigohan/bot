require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    PermissionsBitField
} = require('discord.js');

const {
    loadData,
    saveData,
    ensureUser
} = require('./utils/dataManager');

const checkLevelUp =
    require('./utils/levelManager');

const shop =
    require('./config/shop');

const gacha =
    require('./config/gacha');

// ===== CLIENT =====

const client = new Client({

    intents: [

        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers
    ]
});

// ===== ROLE COLOR =====

const ROLE_MAP = {

    "1365915285613182977":
        "1505148838346887228",

    "1225420846475247726":
        "1505150004627505283",

    "1003612342027833375":
        "1505149957215358996",

    "1029730900507906088":
        "1505150121468366978",

    "1476162901059305472":
        "1505149923677573190",

    "834745010900566046":
        "1505149190160912455",

    "1462957880943575111":
        "1505149344980930750",

    "260269196724797451":
        "1505150679906254961",

    "637474054927941643":
        "1505150622108876880",

    "718082438953173062":
        "1505839509500198942",

    "1351184608850612324":
        "1505150031915913246"
};

// ===== BOMB =====

const explosionGif =
    "https://media.tenor.com/x8v1oNUOmg4AAAAd/explosion-anime.gif";

const timeoutList =
    [5, 10, 15, 30, 60];

const bombChance = 0.05;

// ===== VC =====

const VC_MINUTES = 10;

const VC_POINTS = 10;

// ===== COMMANDS =====

const commands = [

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
        .setName('setcolor')
        .setDescription('ロールカラー変更'),

    new SlashCommandBuilder()
        .setName('mutebomb')
        .setDescription('爆弾ON/OFF')

]
.map(c => c.toJSON());

const rest =
    new REST({ version: '10' })
        .setToken(process.env.TOKEN);

// ===== READY =====

client.once(
    'clientReady',
    async () => {

        console.log(
            `${client.user.tag} 起動`
        );

        await rest.put(

            Routes.applicationCommands(
                client.user.id
            ),

            { body: commands }
        );
    }
);

// ===== MESSAGE =====

client.on(
    'messageCreate',
    async message => {

        if (message.author.bot)
            return;

        if (!message.guild)
            return;

        const data = loadData();

        ensureUser(
            data,
            message.author.id
        );

        // ===== POINT =====

        data.users[
            message.author.id
        ].points += 0.1;

        // ===== LEVEL =====

        const member =
            await message.guild.members.fetch(
                message.author.id
            );

        await checkLevelUp(
            member,
            data.users[message.author.id]
        );

        // ===== BOMB =====

        if (
            !data.mutedBombChannels.includes(
                message.channel.id
            )
        ) {

            if (
                Math.random()
                <= bombChance
            ) {

                try {

                    const seconds =
                        timeoutList[
                            Math.floor(
                                Math.random()
                                * timeoutList.length
                            )
                        ];

                    await message.channel.send(

                        `${explosionGif}\n`
                        + `💥 <@${message.author.id}> 爆発！\n`
                        + `${seconds}秒タイムアウト！`
                    );

                    await member.timeout(
                        seconds * 1000,
                        '爆弾'
                    );

                } catch (err) {
                    console.error(err);
                }
            }
        }

        saveData(data);
    }
);

// ===== VC =====

// ===== VC =====

setInterval(async () => {

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

            if (
                data.users[member.id].voiceMinutes === undefined
            ) {
                data.users[member.id].voiceMinutes = 0;
            }

            data.users[member.id].voiceMinutes += 1;

            // 10分ごとに10pt
            if (data.users[member.id].voiceMinutes >= 10) {

                data.users[member.id].points += 10;
                data.users[member.id].voiceMinutes = 0;

                await checkLevelUp(
                    member,
                    data.users[member.id]
                );
            }
        }
    }

    saveData(data);

}, 60 * 1000);


// ===== INTERACTION =====

client.on(
    'interactionCreate',
    async interaction => {

        if (
            !interaction.isChatInputCommand()
        ) return;

        const data = loadData();

        const userId =
            interaction.user.id;

        ensureUser(data, userId);

        // ===== BALANCE =====

        if (
            interaction.commandName
            === 'balance'
        ) {

            return interaction.reply({

                content:
                    `💰 ${data.users[userId].points.toFixed(1)}pt\n`
                    + `Lv.${data.users[userId].level}`
            });
        }

        // ===== RANK =====

        if (
            interaction.commandName
            === 'rank'
        ) {

            const ranking =
                Object.entries(data.users)

                    .sort(
                        (a, b) =>
                            b[1].points
                            - a[1].points
                    )

                    .slice(0, 10);

            let text =
                '🏆 ランキング\n\n';

            for (
                let i = 0;
                i < ranking.length;
                i++
            ) {

                const user =
                    await client.users.fetch(
                        ranking[i][0]
                    );

                text +=
                    `${i + 1}. `
                    + `${user.username} - `
                    + `${ranking[i][1].points.toFixed(1)}pt\n`;
            }

            return interaction.reply({
                content: text
            });
        }

        // ===== SHOP =====

        if (
            interaction.commandName
            === 'shop'
        ) {

            let text =
                '🛒 SHOP\n\n';

            for (
                const [name, item]
                of Object.entries(shop)
            ) {

                text +=
                    `${name} : `
                    + `${item.price}pt\n`;
            }

            return interaction.reply({
                content: text
            });
        }

        // ===== BUY =====

        if (
            interaction.commandName
            === 'buy'
        ) {

            const itemName =
                interaction.options.getString(
                    'item'
                );

            const item =
                shop[itemName];

            if (!item) {

                return interaction.reply({

                    content:
                        '存在しない商品',

                    ephemeral: true
                });
            }

            if (
                data.users[userId]
                    .points
                < item.price
            ) {

                return interaction.reply({

                    content:
                        'ポイント不足',

                    ephemeral: true
                });
            }

            const member =
                await interaction.guild.members.fetch(
                    userId
                );

            await member.roles.add(
                item.roleId
            );

            data.users[userId]
                .points -= item.price;

            saveData(data);

            // ===== 12H ADMIN =====

            if (
                itemName === 'admin12h'
            ) {

                setTimeout(
                    async () => {

                        try {

                            await member.roles.remove(
                                item.roleId
                            );

                        } catch {}

                    },

                    12 * 60 * 60 * 1000
                );
            }

            return interaction.reply({
                content: '購入成功'
            });
        }

        // ===== GACHA =====

        if (
            interaction.commandName
            === 'gacha'
        ) {

            if (
                data.users[userId]
                    .points
                < gacha.cost
            ) {

                return interaction.reply({

                    content:
                        'ポイント不足',

                    ephemeral: true
                });
            }

            data.users[userId]
                .points -= gacha.cost;

            const roll =
                Math.random();

            const member =
                await interaction.guild.members.fetch(
                    userId
                );

            // ===== GOLD =====

            if (
                roll <=
                gacha.goldenChance
            ) {

                await member.roles.add(
                    gacha.goldenRole
                );

                saveData(data);

                return interaction.reply({

                    content:
                        '🌟 GOLDEN ROLE獲得！'
                });
            }

            // ===== NORMAL =====

            if (
                roll <=
                gacha.normalChance
                + gacha.goldenChance
            ) {

                const roleId =
                    gacha.normalRoles[
                        Math.floor(
                            Math.random()
                            * gacha.normalRoles.length
                        )
                    ];

                await member.roles.add(
                    roleId
                );

                saveData(data);

                return interaction.reply({

                    content:
                        '🎉 ロール獲得！'
                });
            }

            saveData(data);

            return interaction.reply({
                content:
                    '😢 ハズレ！'
            });
        }

        // ===== SETCOLOR =====

        if (
            interaction.commandName
            === 'setcolor'
        ) {

            const roleId =
                ROLE_MAP[userId];

            if (!roleId) {

                return interaction.reply({

                    content:
                        '対応ロールなし',

                    ephemeral: true
                });
            }

            if (!data.colorCooldowns) {
                data.colorCooldowns = {};
            }

            const now =
                Date.now();

            const cooldown =
                24 * 60 * 60 * 1000;

            const last =
                data.colorCooldowns[
                    userId
                ];

            if (
                last &&
                now - last < cooldown
            ) {

                return interaction.reply({

                    content:
                        '1日1回までです',

                    ephemeral: true
                });
            }

            const r =
                Math.floor(
                    Math.random() * 256
                );

            const g =
                Math.floor(
                    Math.random() * 256
                );

            const b =
                Math.floor(
                    Math.random() * 256
                );

            const hex =
                '#'
                + r.toString(16).padStart(2, '0')
                + g.toString(16).padStart(2, '0')
                + b.toString(16).padStart(2, '0');

            try {

                const role =
                    await interaction.guild.roles.fetch(
                        roleId
                    );

                await role.setColor(hex);

                data.colorCooldowns[
                    userId
                ] = now;

                saveData(data);

                return interaction.reply({

                    content:
                        `変更完了\n${hex}`
                });

            } catch (err) {

                console.error(err);

                return interaction.reply({

                    content:
                        '変更失敗',

                    ephemeral: true
                });
            }
        }

        // ===== MUTEBOMB =====

        if (
            interaction.commandName
            === 'mutebomb'
        ) {

            if (
                !interaction.member.permissions.has(
                    PermissionsBitField.Flags.Administrator
                )
            ) {

                return interaction.reply({

                    content:
                        '管理者専用',

                    ephemeral: true
                });
            }

            const channelId =
                interaction.channel.id;

            if (
                data.mutedBombChannels.includes(
                    channelId
                )
            ) {

                data.mutedBombChannels =
                    data.mutedBombChannels.filter(
                        id => id !== channelId
                    );

                saveData(data);

                return interaction.reply({

                    content:
                        '爆弾を有効化'
                });

            } else {

                data.mutedBombChannels.push(
                    channelId
                );

                saveData(data);

                return interaction.reply({

                    content:
                        '爆弾を無効化'
                });
            }
        }
    }
);

client.login(process.env.TOKEN);