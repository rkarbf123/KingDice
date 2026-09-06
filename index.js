const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, StringSelectMenuBuilder } = require('discord.js');
const Database = require('better-sqlite3');

// 토큰이나 뭐 어쩌고저쩌고 설정
const TOKEN = '';
const CLIENT_ID = '';
const GAME_CHANNEL_ID = '';
const WELCOME_CHANNEL_ID = '';
const MASTER_ID = '';
const SHOP_CHANNEL_ID = ''; // 상점 안내 채널 ID
const PURCHASE_CHANNEL_ID = ''; // 구매용 비공개 채널 ID      
const BOT_NAME = "킹 다이스";

// --- 한국 시간 문자열 반환 ---
const getTodayKST = () => {
    const now = new Date();
    const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    return kst.toISOString().split('T')[0];
};

// 데이터베이스 설정
const db = new Database('freakshow.db');
db.prepare(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, 
    money INTEGER DEFAULT 1000, 
    last_check TEXT, 
    last_game_date TEXT,
    chinchiro_count INTEGER DEFAULT 0,
    trump_count INTEGER DEFAULT 0
)`).run();

// 기존 유저 컬럼 추가 예외처리
try { db.prepare(`ALTER TABLE users ADD COLUMN last_game_date TEXT`).run(); } catch (e) { }
try { db.prepare(`ALTER TABLE users ADD COLUMN chinchiro_count INTEGER DEFAULT 0`).run(); } catch (e) { }
try { db.prepare(`ALTER TABLE users ADD COLUMN trump_count INTEGER DEFAULT 0`).run(); } catch (e) { }

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages] });

// rest 생성
const rest = new REST({ version: '10' }).setToken(TOKEN);

// 명령어 정의
const commands = [
    new SlashCommandBuilder().setName('출석체크').setDescription('오늘의 출근 보상을 받습니다.'),
    new SlashCommandBuilder().setName('프로필').setDescription('자신의 재화와 기록을 확인합니다.'),
    new SlashCommandBuilder().setName('미니게임')
        .setDescription('재화를 걸고 게임을 합니다.')
        .addStringOption(opt => opt.setName('종류').setDescription('게임 선택').setRequired(true).addChoices({ name: '친치로', value: 'dice' }, { name: '트럼프', value: 'trump' }))
        .addIntegerOption(opt => opt.setName('베팅액').setDescription('베팅할 금액').setRequired(true)),
    new SlashCommandBuilder().setName('지령')
        .setDescription('단장 전용 지령 하달')
        .addUserOption(opt => opt.setName('대상').setDescription('지령 대상').setRequired(true))
        .addStringOption(opt => opt.setName('내용').setDescription('지령 내용').setRequired(true))
        .addStringOption(opt => opt.setName('유형').setDescription('처벌 유형').setRequired(true).addChoices({ name: '타임아웃', value: 't' }, { name: '닉네임변경', value: 'n' }, { name: '역할부여', value: 'r' }))
        .addIntegerOption(opt => opt.setName('시간').setDescription('지속 시간(분)').setRequired(true)),
    new SlashCommandBuilder()
        .setName('랭킹')
        .setDescription('서버 재화 순위(Top 10)를 확인합니다.'),
].map(command => command.toJSON());

const shopItems = [
    { label: "노래 틀어줘", value: "item_song", price: 5000, description: "원하는 노래 링크를 보내주시면 방송용 플레이리스트에 추가해드리겠습니다." },
    { label: "숟정갱 바텀 듀오 신청", value: "item_duo", price: 1000000, description: "하루 1회 사용 가능" },
    { label: "방송 30분 연장/한 판 더", value: "item_extend", price: 2000000, description: "하루 1회 사용 가능" },
    { label: "이 게임 해줘", value: "item_request", price: 10000000, description: "상황에 따라 제한될 수 있습니다" }
];

// 전역 함수?
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 대사 데이터
const S_ATTEND = ["오늘 출근의 보상입니다", "제시간에 도착하셨네요", "오늘도 즐거운 하루 보내시길", "드디어 쇼가 시작되겠군요", "하나 둘 오기 시작하네요", "자~ 이제 당신의 차례입니다", "출석 명단에 입력하겠습니다", "출석 보너스입니다", "행운을 빕니다", "오늘도 뵙는군요"];
const S_DICE_JACKPOT = ["이런! 주사위가 고장 난 거 아닙니까? 야, 거기! 기계 오류인지 확인하고 와! ...쳇, 축하드립니다. 오늘 당신이 가져갈 몫은 아주 두둑하군요.", "오호, 잭팟이라니! 진심으로 축하드립니다. 오늘만큼은 당신이 이 쇼의 주인공이시네요.", "운이 아주 좋으시군요. 하지만 조심하세요. 그 운이 언제까지 당신 편일 거라고 믿으시는 거죠?", "좋습니다, 가져가시죠. 하지만 잊지 마세요. 제가 이 빚을 다시 되갚아 줄 그날까지... 마음껏 즐기고 계시면 좋겠네요.", "이거 한 방 먹었군요. 가져가시죠. 하지만 다음번에는 이 꼼수는 통하지 않을 겁니다."];
const S_DICE_4X = ["오늘은 운이 좋군요. 5배라니, 믿을 수가 없군요. 당신이? 뭐 행운은 누구에게나 찾아가니깐... 가져가시죠...", "가져가세요. 설마 제가 고작 5배가지고 사기를 치겠습니까?", "이거 이거... 다음번에는 제가 판을 조금 더 철저하게 준비를 해야겠군요", "오늘은 이상하리 만큼 운이 좋으시네요. 여기 있습니다.", "마지막을 5배로 끝내다니! 이거 아쉽네요~"];
const S_DICE_2X = ["2배라니, 오늘의 행운을 여기서 다 써버린 건 아니신지요?", "오, 진심으로 축하드립니다! 그런데 이 돈은 어디다 쓰실 건지 물어봐도 될까요?", "행운의 여신이 당신을 향해 미소를 짓는군", "겨우 이 정도로 만족하시나요? 다음번에는 조금 더 화끈하게 판을 키워보는 게 어떻습니까?", "아직 멀었네요. 2.5배라니... 정말 큰돈을 벌고 싶다면 이 정도로 되겠습니까? 당신 실력을 더 보여달라고요."];
const S_DICE_1X = ["본전을 잃지 않은 것만으로도 좋은 거죠. 이 바닥에서 그게 얼마나 어려운 일인지 모르시나 보군?", "뭐가 불만입니까? 지금 이 순간에도 다 잃고 나가는 사람들이 수두룩한데. 이 정도면 만족할 줄도 알아야죠.", "보상이 너무 적다고요? 그럼 더 도전해 보시든가요. 말리지는 않겠습니다만... 결과는 책임 못 집니다?", "언제까지 이런 푼돈만 챙기실 겁니다? 당신이 더 큰 욕망이 있다면 화끈하게 해야죠!", "나머지 주사위 딱 하나가 당신의 운명을 갈랐군요. 그게 당신이 가진 행운의 전부가 아니길 봅니다."];
const S_DICE_REROLL = ["이 이도저도 아닌 주사위는 대체 뭡니까? 흐름 끊기게 말이죠... 빨리 다시 굴리세요!", "이건 좋은 게 아니에요! 아무런 패도 아니잖습니까. 내키지는 않지만, 규칙상 다시 굴릴 기회를 드리죠.", "지루하군요... 당신 실력이 겨우 이 정도입니까? 기회를 한 번 더 드릴 테니 다시 굴리세요!", "마지막 기회를 드리죠. 정신 차리세요! 1등은 무려 10배라고요! 이걸 노리셔야지, 언제까지 멍하니 계실 겁니까?"];
const S_DICE_LOSE = ["아이고, 아쉽네요~ 하지만 약속은 약속이죠. 베팅액의 두 배는 기쁘게 가져가도록 하겠습니다.", "오호, 오늘은 행운의 여신이 당신이 아닌 저에게 미소를 짓는군요.", "돈을 조금 잃었다고 너무 실망하지 마세요. 다시 따서 갚으면 되지 않습니까?", "이런, 아쉽게도 마이너스를 기록하셨네요~ 아무래도 오늘은 당신의 날이 아닌가 봐요?", "지난번에 행운을 다 써버린 거 아니에요? 거봐요, 너무 무리하지 말라고 제가 경고했지 않습니까."];
const S_DICE_BIGLOSE = ["하하하! 내가 그럴 줄 알았!.. 흠흠, 미안합니다. 뭐 그런 날도 있는 거죠. 그렇죠? 우리 고마운 고객님?", "어떻게 이런 일이... 고작 1등과 숫자 조금 다르다는 이유로 배팅의 4배를 잃다니, 정말 슬프네요. ㅎㅎ 그렇죠?", "이런, 오늘은 날이 아닌가 보네요. 정말 아쉽게 됐습니다. 뭐, 다음에 다시 오셔서 따면 되죠~ 안 그렇습니까?", "아이고 저런, 따두었던 돈은 다시 갚으신 듯하네요. 아, 아직 부족한가요?", "심판의 시간입니다. 아니, 벌을 받을 시간입니다. 약속대로 당신 배팅의 4배를 가져가도록 하죠."];
const S_TRUMP_WIN = ["이런... 제가 밑장빼기는 뭐라고 했죠? 뭐, 농담입니다. 그래도 조심하는게 좋을 겁니다.", "다음에는 조금 더 연습을... 아닙니다. 여기, 당신이 딴 돈은 드리겠습니다. 운이 좋으시군요.", "이 빚은 언젠가 반드시 갚을 겁니다. 당신의 그 가벼운 주머니가 다시 묵직해질 때쯤... 제가 직접 찾아가죠.", "행운이 당신의 손을 들어주었다고 다음에도 그러리라고는 생각하지 마세요.", "이 패가 깨끗하지 않으면 당신은 손목을 내놔야 한다는 것을 모르시나요? 하하, 농담입니다.", "작은 거 한 판에 인생은 예술이 된다고 하죠"];
const S_TRUMP_LOSE = ["이 판의 승리는 저군요. 안타깝게도 제가 이겼습니다. 뭐, 실력 차이라고 해두죠.", "그러게 진작에 죽으셨어야지", "아쉽네요. 카드가 조금만 더 잘 떴더라면 당신이 이겼을지도 모르는데 말이죠...", "이건 제가 그냥 이겼군요. 판돈은 그냥 제가 가져가겠습니다", "승부는 끝났습니다. 약속대로 돈은 제가 가져가죠.", "확실하지 않으면 승부를 걸지 말라는 말 모르십니까?"];
const S_MISSION = ["주목! 단장님이 여러분에게 직접 지령을 내리셨습니다. 토를 달 생각은 마세요. 오늘의 지령은... [지령]입니다.", "지령이 하달되었습니다. 다들 아시겠지만, 실패한다면 규칙에 따르게 될 겁니다. 자, 내용은 이렇습니다. [지령]", "단장님께서 전달하라고 하시는군요. 오늘의 지령은 [지령]입니다", "단장님이 [지령] 이것을 수행하라고 하십니다.", "여기 단장님께서 직접 제게 넘겨주신 지령이 있습니다. [지령]"];

async function playTrump(interaction, bet, user, today) {
    const userId = interaction.user.id;
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const rankValues = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

    const drawCard = () => {
        const s = pick(suits);
        const r = pick(ranks);
        return { display: `${s}${r}`, value: rankValues[r] };
    };

    // editreply
    await interaction.editReply({
        embeds: [new EmbedBuilder()
            .setTitle("🃏 트럼프 게임")
            .setDescription("킹 다이스가 카드를 새것으로 교체하고 현란하게 셔플합니다...\n먼저 제 카드부터 뽑아보죠.")
            .setColor(0xFFFF00)]
    });
    await wait(1500);

    const dealerCard = drawCard();
    const playerCard = drawCard();

    await interaction.editReply({
        embeds: [new EmbedBuilder()
            .setTitle("🃏 킹 다이스의 차례")
            .setDescription(`킹 다이스의 카드: **[ ${dealerCard.display} ]**\n\n자, 당신의 운명은 어떻습니까? 직접 뒤집어보시죠.`)
            .setColor(0xFFFF00)]
    });
    await wait(1500);

    let resultMsg = "";
    let change = 0;
    let winType = 0; // 1:승, 2:패, 3:무

    if (playerCard.value > dealerCard.value) {
        winType = 1;
        change = bet;
        resultMsg = pick(S_TRUMP_WIN);
    } else if (playerCard.value < dealerCard.value) {
        winType = 2;
        change = -bet;
        resultMsg = pick(S_TRUMP_LOSE);
    } else {
        winType = 3;
        change = 0;
        resultMsg = "오호, 비겼군요? 서로의 패가 같다니... 이번 판은 무효로 처리해드리죠.";
    }

    // 트럼프 횟수 증가 및 날짜 업데이트
    db.prepare('UPDATE users SET money = money + ?, trump_count = trump_count + 1, last_game_date = ? WHERE id = ?').run(change, today, userId);
    const updatedUser = db.prepare('SELECT money FROM users WHERE id = ?').get(userId);

    const resultEmbed = new EmbedBuilder()
        .setTitle(winType === 1 ? "당신의 승리입니다!" : (winType === 2 ? "패배하셨군요." : "무승부"))
        .setDescription(`${resultMsg}\n\n━━━━━━━━━━━━━━\n킹 다이스의 패: [ ${dealerCard.display} ]\n당신의 패: [ ${playerCard.display} ]\n━━━━━━━━━━━━━━\n\n결과: ${change > 0 ? '+' : ''}${change.toLocaleString()} G\n현재 잔고: ${updatedUser.money.toLocaleString()} G`)
        .setColor(winType === 1 ? 0x00FF00 : (winType === 2 ? 0xFF0000 : 0x808080))
        .setTimestamp();

    return interaction.editReply({ embeds: [resultEmbed] });
}

async function setupShop(channelId) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return console.error("상점 채널을 찾을 수 없습니다.");

        const messages = await channel.messages.fetch({ limit: 50 });
        const botShopMsg = messages.find(m => m.author.id === client.user.id && m.embeds[0]?.title === "상점");

        if (botShopMsg) {
            console.log("이미 상점 메시지가 존재합니다.");
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle("상점")
            .setDescription("어서오십시오! 이곳은 단원들을 위한 특별한 상점입니다.\n\n아래 **입장하기** 버튼을 누르면 전용 구매 채널이 활성화됩니다.\n재화가 충분한지 확인하시고 입장해주세요.")
            .setColor(0x5865F2)
            .setThumbnail(client.user.displayAvatarURL())
            .setFooter({ text: "킹 다이스가 당신의 지갑을 환영합니다." });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('shop_enter').setLabel('입장하기').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('shop_exit').setLabel('퇴장하기').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('shop_help').setLabel('도움말').setStyle(ButtonStyle.Secondary)
        );

        await channel.send({ embeds: [embed], components: [row] });
        console.log("상점 메시지 생성 완료!");
    } catch (e) {
        console.error("상점 세팅 중 오류:", e);
    }
}

// client once
client.once(Events.ClientReady, async () => {
    console.log(`${client.user.tag} 킹 다이스 로그인 완료!`);

    try {
        console.log('명령어 새로고침 중...');
        // 명령어 초기화
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });

        // 명령어 다시 등록
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('명령어 등록이 완료되었습니다.');

        await setupShop(SHOP_CHANNEL_ID);

        /*
        const channel = await client.channels.fetch(WELCOME_CHANNEL_ID);
        if (channel) {
            const botWelcomeEmbed = new EmbedBuilder()
                .setTitle("무대의 막이 올랐습니다!")
                .setDescription(`친애하는 신사, 숙녀 여러분 모두 반갑습니다!\n\n저는 이제부터 디지털 프릭쇼의 지배인이자 단장님을 보좌하게 될 **킹 다이스**라고 합니다.\n\n자- 이제 무대의 막은 올랐으니 쇼를 시작하죠!`)
                .setColor(0xFF0000)
                .setThumbnail(client.user.displayAvatarURL())
                .setFooter({ text: "이용해주셔서 감사합니다." })
                .setTimestamp();

            channel.send({ embeds: [botWelcomeEmbed] });
        } */ // 일회성
    } catch (e) {
        console.error("준비 단계 중 에러 발생:", e); // 예외처리
    }
});

client.on('messageCreate', async (message) => {
    // 1. 예외 처리: 봇이 쓴 글이거나 DM이면 무시
    if (message.author.bot || !message.guild) return;

    const userId = message.author.id;
    const username = message.author.username;

    // 2. 유저 데이터가 DB에 없으면 생성 (초기자금 0원)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
        db.prepare('INSERT INTO users (id, money) VALUES (?, ?)').run(userId, 0);
    }

    // 3. 보상 설정 (기본 1G)
    let reward = 1;
    let isJackpot = false;

    // 4. 0.5% 확률로 100G 잭팟 (Math.random()이 0.005보다 작으면 당첨)
    if (Math.random() < 0.005) {
        reward = 101; // 기본 1G + 잭팟 100G
        isJackpot = true;
    }

    // 5. DB 업데이트
    db.prepare('UPDATE users SET money = money + ? WHERE id = ?').run(reward, userId);

    // 6. 잭팟 발생 시 알림 전송
    if (isJackpot) {
        const gameChannel = await client.channels.fetch(GAME_CHANNEL_ID).catch(() => null);
        if (gameChannel) {
            const jackpotEmbed = new EmbedBuilder()
                .setTitle("채팅 잭팟!")
                .setDescription(`<@${userId}>님이 채팅을 하다가 바닥에서 **100 G**를 추가로 주웠습니다!\n(현재 획득: **${reward} G**)`)
                .setColor(0xF1C40F)
                .setTimestamp();

            gameChannel.send({ embeds: [jackpotEmbed] });
        }
    }
});

// 서버 멤버 입장
client.on(Events.GuildMemberAdd, async (member) => {
    try {
        const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID);
        if (channel) {
            const userWelcomeEmbed = new EmbedBuilder()
                .setTitle("🎭 새로운 단원 입단!")
                .setAuthor({ name: BOT_NAME, iconURL: client.user.displayAvatarURL() })
                .setDescription(`Greetings **${member.user.username}**, Welcome to the Digital Freak Show!\n\n저는 디지털 프릭쇼의 지배인이자 단장님을 보좌하는 **킹 다이스**라고 합니다!\n\n입단 절차를 진행합니다. <#1447103151332397099>을 확인한 후 입단 절차를 완료해 주세요. <#1448333174248575059> \n역할을 선택하는 순간 당신은 디지털 프릭쇼의 정식 단원입니다!\n\n그럼 같이 쇼를 즐기러 가볼까요?`)
                .setColor(0x5865F2)
                .setThumbnail(member.user.displayAvatarURL())
                .setFooter({ text: "규칙을 준수하지 않을 시 단장님께서 찾아가실 겁니다." })
                .setTimestamp();

            channel.send({ content: `${member}`, embeds: [userWelcomeEmbed] });
        }
    } catch (e) {
        console.error("유저 환영 메시지 전송 실패:", e);
    }
});
// 상호작용 명령어 처리
client.on(Events.InteractionCreate, async interaction => {

    const today = getTodayKST();
    const userId = interaction.user.id;
    const { channelId } = interaction;
    let user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    if (!user) {
        db.prepare('INSERT INTO users (id, money, last_game_date, chinchiro_count, trump_count) VALUES (?, 1000, ?, 0, 0)').run(userId, today);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    }

    if (user.last_game_date !== today) {
        db.prepare('UPDATE users SET last_game_date = ?, chinchiro_count = 0, trump_count = 0 WHERE id = ?').run(today, userId);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    }

    if (interaction.isChatInputCommand()) {
        if (
            channelId !== GAME_CHANNEL_ID &&
            channelId !== SHOP_CHANNEL_ID &&
            channelId !== PURCHASE_CHANNEL_ID &&
            interaction.commandName !== '지령'
        ) {
            return interaction.reply({ content: `<#${GAME_CHANNEL_ID}> 채널에서만 이용해주세요.`, ephemeral: true });
        }

        client.on(Events.MessageCreate, async (message) => {
            if (message.author.bot) return;

            const userId = message.author.id;
            let user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
            if (!user) {
                db.prepare('INSERT INTO users (id, money) VALUES (?, 1000)').run(userId);
            }
        });

        // 랭킹
        if (interaction.commandName === '랭킹') {
            // 모든 유저 데이터 가져오기
            let allUsers = db.prepare('SELECT * FROM users').all();

            // 내림차순일까?
            allUsers.sort((a, b) => b.money - a.money);

            // 10명만
            const topUsers = allUsers.slice(0, 10);

            // db 참조해야되는데 이건 알아서 짜셈
            const myRankIndex = allUsers.findIndex(u => u.id === interaction.user.id);
            const myRankText = myRankIndex !== -1 ? `${myRankIndex + 1}위` : "순위 외";

            const embed = new EmbedBuilder()
                .setColor('#F1C40F') // 제목 색깔
                .setTitle('골드 순위 TOP 10')
                .setThumbnail(client.user.displayAvatarURL())
                .setTimestamp();

            // 랭킹 생성 임베드 메시지로
            const desc = topUsers.map((row, i) => {
                const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `\` ${i + 1} \``;
                return `${medal} <@${row.id}>\n보유 재화: **${row.money.toLocaleString()} G**`;
            }).join('\n\n');

            embed.setDescription(desc || "아직 기록된 단원이 없습니다.")
                .addFields({
                    name: '━━━━━━━━━━━━━━━━━━━━',
                    value: `👤 **${interaction.user.username}님의 순위:** **${myRankText}**\n현재 잔고: **${user.money.toLocaleString()} G**`
                });

            await interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === '출석체크') {
            if (user.last_check === today) return interaction.reply({ content: "이미 출석하셨습니다.", ephemeral: true });
            db.prepare('UPDATE users SET money = money + 3000, last_check = ? WHERE id = ?').run(today, userId);
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle("출석 완료").setDescription(`${pick(S_ATTEND)}\n\n**+ 3,000 G**`).setColor(0x00FF00)] });
        }

        if (interaction.commandName === '프로필') {
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`🎭 ${interaction.user.username}의 기록`).setDescription(`보유 재화: **${user.money.toLocaleString()} G**`).setColor(0x5865F2)] });
        }
        // 미니게임 ========================================================================================
        if (interaction.commandName === '미니게임') {

            const type = interaction.options.getString('종류');
            const bet = interaction.options.getInteger('베팅액');

            if (type === 'dice' && user.chinchiro_count >= 3) {
                return interaction.reply({ content: "친치로는 하루에 3번만 가능합니다. 내일 다시 오시죠.", ephemeral: true });
            }
            if (type === 'trump' && user.trump_count >= 1) {
                return interaction.reply({ content: "트럼프는 하루에 1번만 가능합니다. 내일 다시 오시죠.", ephemeral: true });
            }

            // 2. 자금 및 금액 체크
            if (bet <= 0 || user.money < bet) {
                return interaction.reply({ content: "재화 부족 또는 잘못된 금액입니다.", ephemeral: true });
            }

            // editreply 써야함
            await interaction.deferReply();

            if (type === 'dice') {
                await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("친치로 시작").setDescription("킹 다이스가 주사위 컵을 화려하게 흔듭니다...").setColor(0xFFFF00)] });
                await wait(1500);

                let roll = () => [0, 0, 0].map(() => Math.floor(Math.random() * 6) + 1);
                const getRank = (d) => {
                    const tempDice = [...d].sort();
                    const s = tempDice.join('');
                    if (s === '111') return { r: 1, m: 10, msg: pick(S_DICE_JACKPOT) };
                    // 트리플
                    if (tempDice[0] === tempDice[1] && tempDice[1] === tempDice[2]) return tempDice[0] === 6 ? { r: 7, m: -0.5, msg: pick(S_DICE_BIGLOSE) } : { r: 2, m: 4, msg: pick(S_DICE_4X) };
                    if (s === '456') return { r: 3, m: 2.5, msg: pick(S_DICE_2X) };
                    if (s === '123') return { r: 6, m: -2, msg: pick(S_DICE_LOSE) };
                    if (tempDice[0] === tempDice[1]) return { r: 4, p: tempDice[2] };
                    if (tempDice[1] === tempDice[2]) return { r: 4, p: tempDice[0] };
                    if (tempDice[0] === tempDice[2]) return { r: 4, p: tempDice[1] };
                    return { r: 5 };
                };

                let dice = roll();
                let res = getRank(dice);

                for (let i = 1; i <= 3; i++) {
                    let current = dice.slice(0, i).join(', ') + (i < 3 ? ', ?'.repeat(3 - i) : '');
                    await interaction.editReply({
                        embeds: [new EmbedBuilder().setTitle("결과 확인 중...").setDescription(`주사위: **[ ${current} ]**`).setColor(0xFFFF00)]
                    });
                    await wait(1000);
                }

                if (res.r === 5) {
                    await interaction.editReply({
                        embeds: [new EmbedBuilder().setTitle("눈 없음!").setDescription(`결과: [ ${dice.join(', ')} ]\n\n${pick(S_DICE_REROLL)}`).setColor(0x808080)]
                    });
                    await wait(2500);
                    await interaction.editReply({
                        embeds: [new EmbedBuilder().setTitle("재굴림 시도").setDescription("킹 다이스가 쯧 소리를 내며 주사위를 다시 컵에 담고 흔듭니다!").setColor(0xFFFF00)]
                    });
                    await wait(1500);

                    dice = roll();
                    res = getRank(dice);

                    for (let i = 1; i <= 3; i++) {
                        let current = dice.slice(0, i).join(', ') + (i < 3 ? ', ?'.repeat(3 - i) : '');
                        await interaction.editReply({
                            embeds: [new EmbedBuilder().setTitle("재굴림 결과 확인 중...").setDescription(`주사위: **[ ${current} ]**`).setColor(0xFFFF00)]
                        });
                        await wait(1000);
                    }
                }

                let change = 0, fMsg = "";
                if ([1, 2, 3].includes(res.r)) {
                    change = bet * (res.m - 1); fMsg = res.msg;
                } else if (res.r === 6) {
                    change = bet * res.m; fMsg = res.msg;
                } else if (res.r === 7) {
                    change = -(Math.floor(user.money * 0.5));
                    if (bet > user.money) change = -user.money;
                    fMsg = "죗값을 치러라! " + res.msg;
                } else if (res.r === 4) {
                    const mt = { 1: -0.2, 2: 1, 3: 1.2, 4: 1.4, 5: 1.6, 6: 1.8 };
                    change = Math.floor(bet * mt[res.p]);
                    fMsg = change > 0 ? pick(S_DICE_1X) : pick(S_DICE_LOSE);
                } else {
                    change = -bet; fMsg = "두 번 다 눈이 없다니... ";
                }

                // DB 업데이트
                db.prepare('UPDATE users SET money = money + ?, chinchiro_count = chinchiro_count + 1, last_game_date = ? WHERE id = ?').run(change, today, userId);

                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setTitle("친치로 최종 결과")
                        .setDescription(`최종 주사위: **[ ${dice.join(', ')} ]**\n\n${fMsg}\n\n**결과: ${change.toLocaleString()} G**`)
                        .setColor(change >= 0 ? 0x00FF00 : 0xFF0000)]
                });

            } else if (type === 'trump') {
                // 여기도 editreply, 위에 async도 editreply로
                await playTrump(interaction, bet, user, today);
            }
        }

        if (interaction.commandName === '지령') {
            if (interaction.user.id !== MASTER_ID) return interaction.reply({ content: "단장님 전용입니다.", ephemeral: true });

            const target = interaction.options.getMember('대상');
            const content = interaction.options.getString('내용');
            const type = interaction.options.getString('유형');
            const time = interaction.options.getInteger('시간');
            const gold = interaction.options.getInteger('금액');

            // 지령 하달 임베드
            const missionEmbed = new EmbedBuilder()
                .setTitle("단장 지령 하달")
                .setDescription(pick(S_MISSION).replace("[지령]", `**${content}**`))
                .addFields(
                    { name: "수행자", value: `${target}`, inline: true },
                    // { name: "실패 시 페널티", value: type === 't' ? `타임아웃 (${time}분)` : (type === 'n' ? '닉네임 강제 변경' : '심판의 역할 부여'), inline: true } 걍 짜침 없애자
                )
                .setColor(0xFFA500)
                .setFooter({ text: "단장님의 판결을 기다립니다." })
                .setTimestamp();

            await interaction.channel.send({ content: `${target}님, 지령을 완수하십시오.성공 시 ${gold} G를 드립니다!`, embeds: [missionEmbed] });

            // 버튼 생성 (em어쩌고)
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('mission_success')
                    .setLabel('성공')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('mission_fail')
                    .setLabel('실패')
                    .setStyle(ButtonStyle.Danger)
            );

            const response = await interaction.reply({
                content: `${target.displayName} 결과를 선택하세요.`,
                components: [row],
                ephemeral: true
            });

            // 버튼 생성 2 (em어쩌고)
            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 3600000 // 판결 범위
            });

            collector.on('collect', async i => {
                if (i.user.id !== MASTER_ID) {
                    return i.reply({ content: "단장님만이 판결을 내릴 수 있습니다.", ephemeral: true });
                }

                if (i.customId === 'mission_success') {
                    const successEmbed = EmbedBuilder.from(missionEmbed)
                        .setTitle("지령 완수")
                        .setDescription(`**${target.displayName}** 단원이 지령을 훌륭히 완수했습니다.\n\n단장님이 수고했다며 봉투를 건넵니다.\n**+ ${gold.toLocaleString()} G**`)
                        .setColor(0x00FF00)
                        .setFooter({ text: "킹 다이스가 물러갑니다." });
                    db.prepare('UPDATE users SET money = money + ? WHERE id = ?').run(gold, target.id);

                    await i.update({ embeds: [successEmbed], components: [] });
                    collector.stop();
                }

                else if (i.customId === 'mission_fail') {
                    try {
                        let pMsg = "";
                        if (type === 't') {
                            await target.timeout(time * 60000, `지령 실패 처벌`);
                            pMsg = `${time}분간 타임아웃 되었습니다.`;
                        }
                        else if (type === 'n') {
                            const oldNickname = target.displayName;
                            await target.setNickname(`[청소부] ${oldNickname}`);
                            pMsg = `[청소부]로 변경되었습니다.`;
                            setTimeout(() => target.setNickname(oldNickname).catch(() => { }), time * 60000);
                        }
                        else if (type === 'r') {
                            let role = interaction.guild.roles.cache.find(r => r.name === '벌칙');
                            if (!role) role = await interaction.guild.roles.create({ name: '벌칙', color: '#FF0000' });
                            await target.roles.add(role);
                            pMsg = `'벌칙' 역할이 부여되었습니다.`;
                            setTimeout(() => target.roles.remove(role).catch(() => { }), time * 60000);
                        }

                        const failEmbed = new EmbedBuilder()
                            .setTitle("지령 실패")
                            .setDescription(`**${target.displayName}** 단원은 지령 수행에 실패했습니다.`)
                            .addFields({ name: "집행 결과", value: pMsg })
                            .setColor(0xFF0000);

                        await interaction.channel.send({ embeds: [failEmbed] });
                        await i.update({ embeds: [failEmbed], components: [] });

                    } catch (err) {
                        console.error(err);
                        await i.reply({ content: "처벌 집행 중 권한 부족으로 실패했습니다.", ephemeral: true }); // 권한부족 예외처리
                    }
                    collector.stop();
                } // mission_fail 끝
            });

            collector.on('end', (collected, reason) => {
                if (reason === 'time') {
                    interaction.editReply({ components: [] }).catch(() => { });
                }
            });
        }
    }

    // 버튼 클릭 처리
    if (interaction.isButton()) {
        const purchaseChannel = await interaction.guild.channels.fetch(PURCHASE_CHANNEL_ID);

        if (interaction.customId === 'shop_enter') {
            // 권한 부여
            await purchaseChannel.permissionOverwrites.edit(interaction.user, { ViewChannel: true });

            // 구매 메뉴
            const shopEmbed = new EmbedBuilder()
                .setTitle("구매를 환영합니다!")
                .setDescription(`## 상점에 입장하셨습니다!\n좌측의 <#${PURCHASE_CHANNEL_ID}> 채널이 활성화되었습니다.\n\n현재 **${interaction.user.username}**님의 잔고: **${user.money.toLocaleString()} G**\n원하시는 항목을 선택하세요.`)
                .setColor(0x00FF00);

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('shop_buy')
                .setPlaceholder('구매할 항목을 선택하세요')
                .addOptions(shopItems.map(item => ({
                    label: item.label,
                    description: `${item.price.toLocaleString()} G - ${item.description}`,
                    value: item.value
                })));

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await interaction.reply({
                embeds: [shopEmbed],
                components: [row],
                ephemeral: true
            });

            await purchaseChannel.send({
                content: `${interaction.user}님이 입장하셨습니다.`,
            });
        }

        if (interaction.customId === 'shop_exit') {
            await purchaseChannel.permissionOverwrites.delete(interaction.user);
            await interaction.reply({ content: "상점에서 퇴장하셨습니다. 다음에 또 오시길!", ephemeral: true });
        }

        if (interaction.customId === 'shop_help') {
            await interaction.reply({
                content: "### 상점 이용 안내\n1. **입장하기**를 누르면 구매 채널이 보입니다.\n2. 구매 채널에서 상품을 선택하면 골드가 차감됩니다.",
                ephemeral: true
            });
        }
    }

    // 2. 드롭다운 메뉴 처리
    if (interaction.isStringSelectMenu() && interaction.customId === 'shop_buy_menu') {
        const selectedValue = interaction.values[0];
        const item = shopItems.find(i => i.value === selectedValue);

        if (user.money < item.price) {
            return interaction.reply({ content: `재화가 부족합니다! (필요: ${item.price.toLocaleString()} G)`, ephemeral: true });
        }

        // 구매 처리
        db.prepare('UPDATE users SET money = money - ? WHERE id = ?').run(item.price, userId);
        const updatedUser = db.prepare('SELECT money FROM users WHERE id = ?').get(userId);

        // 상점 채널 알림
        const shopChannel = await interaction.guild.channels.fetch(SHOP_CHANNEL_ID);
        const logEmbed = new EmbedBuilder()
            .setTitle("거래 완료!")
            .setDescription(`<@${userId}> 단원이 상품을 구매했습니다.`)
            .addFields(
                { name: "상품명", value: item.label, inline: true },
                { name: "가격", value: `${item.price.toLocaleString()} G`, inline: true }
            )
            .setColor(0xFFFF00);

        await shopChannel.send({ embeds: [logEmbed] });

        // 유저 알림
        await interaction.reply({
            content: `**구매 완료!**\n상품: **${item.label}**\n남은 잔고: ${updatedUser.money.toLocaleString()} G`,
            ephemeral: true
        });
    }
});

client.login(TOKEN);
