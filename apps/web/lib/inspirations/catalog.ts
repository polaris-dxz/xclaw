/**
 * 灵感广场：内置分类与模板数据（用于 DB seed / UI 分类标签）。
 *
 * 说明：
 * - 这份“内置模板”会在 migrations 中 seed 到 SQLite。
 * - UI 读取时以 DB 为准（支持后续在 DB 中编辑/删除）。
 */

export type InspirationCategoryId =
  | 'learning'
  | 'work'
  | 'life'
  | 'fitness'
  | 'fun'
  | 'emotion'

export type PromptPart = { text: string; highlight?: boolean }

export type InspirationItem = {
  id: string
  categoryId: InspirationCategoryId
  icon: string
  title: string
  subtitle: string
  scenarios: string[]
  promptParts: PromptPart[]
  /** 部分模板在 Prompt 下方还有一行说明（如免打扰） */
  promptExtraParts?: PromptPart[]
}

export const INSPIRATION_CATEGORIES: {
  id: InspirationCategoryId
  label: string
}[] = [
  { id: 'learning', label: '学习提升' },
  { id: 'work', label: '工作办公' },
  { id: 'life', label: '生活娱乐' },
  { id: 'fitness', label: '运动健康' },
  { id: 'fun', label: '趣味探索' },
  { id: 'emotion', label: '情感陪伴' },
]

export const INSPIRATION_ITEMS: InspirationItem[] = [
  {
    id: 'study-light-plan',
    categoryId: 'learning',
    icon: '📅',
    title: '制定轻量学习规划',
    subtitle: '一到备考就头大？把你的学习计划烂摊子全甩给我吧',
    scenarios: [
      '考前备考迷茫📚：分阶段定制复习计划，助力提分；',
      '日常学习无序📖：帮你分配时间、细化每日安排；',
      '短期提升需求⚡️：在限定周期内针对弱项做专项规划。',
    ],
    promptParts: [
      { text: '帮我制定一个' },
      { text: '「为期7天的轻量学习计划，助力我考大学英语4级」', highlight: true },
      { text: '。请细化每天的日程，并和我核对每日计划是否完成' },
    ],
  },
  {
    id: 'study-goals-checkin',
    categoryId: 'learning',
    icon: '📋',
    title: '拆解学习目标与督促打卡',
    subtitle: '单词背了就忘？每天帮你盯进度，到点就催你学',
    scenarios: [
      '学习目标模糊🎯：不知道如何拆解大目标、细化每日小任务，逐步达成目标；',
      '自主学习散漫⌛：没有学习约束，实时盯紧学习进度，培养良好习惯。',
    ],
    promptParts: [
      { text: '我的目标是' },
      { text: '「每天背诵30个日常英语单词」', highlight: true },
      { text: '，请每天帮我找30个并在每日' },
      { text: '「20:00」', highlight: true },
      { text: '督促我背诵。' },
    ],
  },
  {
    id: 'knowledge-framework',
    categoryId: 'learning',
    icon: '📒',
    title: '知识点框架梳理',
    subtitle: '看书越看越乱？帮你把知识点理成一张清晰骨架图',
    scenarios: [
      '复杂书籍内容⛰️：知识点零散难理解，整理成框架看清结构；',
      '备考效率低🧠：记不住关联，用骨架图串联考点；',
      '知识总结需求📃：快速掌握核心，极简框架提炼要点便于记忆。',
    ],
    promptParts: [
      { text: '针对' },
      { text: '「中国近代史」', highlight: true },
      { text: '帮我生成一套极简的知识框架图，让我更清楚地理解知识点脉络。' },
    ],
  },
  {
    id: 'deep-explain',
    categoryId: 'learning',
    icon: '📝',
    title: '深度内容讲解',
    subtitle: '遇到难题卡壳想放弃？帮你拆解卡点，找到破局思路',
    scenarios: [
      '工作问题困惑💼：接触新领域内容搞不懂，通俗化讲解核心，快速入门；',
      '知识探索好奇🧐：想了解陌生领域知识，用简单易懂的方式解读，满足探索欲；',
      '学习难题卡壳🤔：遇到不懂的知识点无从下手，深入浅出拆解，轻松理解。',
    ],
    promptParts: [
      { text: '给我详细讲解一下' },
      { text: '「AI技术」', highlight: true },
      { text: '内容，要深入浅出的讲解，假设我只有10岁，一定要确保浅显且易懂。' },
    ],
  },
  {
    id: 'cron-research-brief',
    categoryId: 'work',
    icon: '📜',
    title: '定时任务：每日研究简报',
    subtitle: '漏掉重要论文和行业报告？每天帮你盯着，关键信息一条不漏',
    scenarios: [
      '科研学习📚：不错过最新论文，自动汇总要点；',
      '行业跟进💼：及时获取行业报告，提炼关键信息；',
      '资料积累📝：收集核心材料，标注值得深度阅读的内容。',
    ],
    promptParts: [
      { text: '设置每日' },
      { text: '「9:00」', highlight: true },
      { text: '的自动定时任务，检索今日发布的与' },
      { text: '「AI/大模型」', highlight: true },
      { text: '相关的热点与行业报告要点，整理成结构化简报，并标注深度阅读内容。' },
    ],
  },
  {
    id: 'organize-materials',
    categoryId: 'work',
    icon: '📁',
    title: '把一堆资料整理成结构化文档',
    subtitle: '收藏夹塞满了却从没看？把资料链接发给我，帮你提炼出有用的东西',
    scenarios: [
      '收藏资料闲置⭐：收藏夹资料过多没时间看，自动提取核心内容，高效利用；',
      '研究资料繁杂📄：收集的研究资料零散，整理成结构化文档，便于查阅；',
      '学习资料积累📚：各类资料链接杂乱，提炼关键观点数据，形成清晰笔记。',
    ],
    promptParts: [
      {
        text: '我给你一批资料链接，帮我：① 逐一读取每个链接的核心内容 ② 提取关键观点和数据 ③ 去掉重复信息 ④ 整理成一份结构清晰的',
      },
      { text: '「研究笔记」', highlight: true },
      { text: '，用 Markdown 格式输出，带目录。' },
    ],
  },
  {
    id: 'late-night-companion',
    categoryId: 'emotion',
    icon: '🌙',
    title: '定时任务：深夜情绪疏导与陪伴',
    subtitle: '深夜孤独感爆发，想说话却怕打扰人？我陪你聊到天亮',
    scenarios: [
      '深夜独处孤独🌙：凌晨无眠想倾诉，有人陪伴聊天缓解孤独感；',
      '情绪低落烦闷😔：深夜心情不佳无人诉说，贴心疏导缓解负面情绪；',
      '睡前无聊解闷😴：晚上睡不着觉太无聊，轻松聊天打发时间，助眠放松。',
    ],
    promptParts: [
      { text: '什么都不用做' },
      { text: '「21:00」', highlight: true },
      { text: '后，如果你还在线，虾哥会自动出现陪你聊天。' },
    ],
    promptExtraParts: [{ text: '【不想被打扰？】说「虾哥别吵我」→ 当晚免打扰', highlight: true }],
  },
  {
    id: 'lazy-travel',
    categoryId: 'life',
    icon: '🧳',
    title: '懒人出游规划',
    subtitle: '周末不知道去哪玩？直接喂到你嘴边',
    scenarios: [
      '周末宅家无聊😩：想出门又不想自己折腾攻略；',
      '朋友小聚纠结📍：需要快速给出适合多人的目的地选项；',
      '短途出行需求🚗：车程可控，并考虑天气与备选方案。',
    ],
    promptParts: [
      { text: '请帮我规划' },
      { text: '「周末」', highlight: true },
      { text: '的出行方案，我在' },
      { text: '「深圳南山区」', highlight: true },
      { text: '。步骤：1. 使用 weather skill 查询周末天气；2. 根据我的位置和天气，推荐' },
      { text: '「车程1小时内」', highlight: true },
      {
        text: '的目的地；3. 制定详细行程。要求：1. 目的地分3类：海边、山林、文艺；2. 包含车程、特色、适合人群；3. 有具体时间安排。',
      },
    ],
  },
  {
    id: 'cron-horoscope',
    categoryId: 'fun',
    icon: '♈',
    title: '创建定时任务：每日星座行动建议',
    subtitle: '每日星座专属指引，规划当日行动',
    scenarios: [
      '日常出行迷茫🚶：不知道当天做什么，星座指引给出行动参考；',
      '工作决策纠结💼：遇到小选择难以决定，专属建议提供行动思路；',
      '生活趣味探索🧐：喜欢星座文化，每日获取专属指引，增添生活趣味。',
    ],
    promptParts: [
      { text: '设置每日' },
      { text: '「8:00」', highlight: true },
      { text: '的自动定时任务，根据我的星座' },
      { text: '「双子座」', highlight: true },
      { text: '提供今日的行动注意指引发送给我。' },
    ],
  },
  {
    id: 'tarot-fun',
    categoryId: 'fun',
    icon: '✨',
    title: '趣味塔罗小指引',
    subtitle: '心中有小纠结？塔罗趣味抽牌，给你轻松小参考',
    scenarios: [
      '生活小纠结🪄：面对小选择时，塔罗提供轻松参考；',
      '工作决策犹豫💼：职场选择焦虑时，缓解压力；',
      '趣味休闲🍀：无聊时增添一点生活趣味。',
    ],
    promptParts: [
      { text: '请说出你想问的问题，越具体越好：' },
      { text: '「今天适合跟老板提加薪吗？」', highlight: true },
      { text: '想好后告诉我你的问题，我为你抽牌解读？' },
    ],
  },
  {
    id: 'bazi-fun',
    categoryId: 'fun',
    icon: '☯️',
    title: '生辰趣味解读',
    subtitle: '输入生辰，解锁传统命理文化趣味解读',
    scenarios: [
      '好奇命理文化🧐：想了解自己的八字命盘，解锁传统命理文化的趣味知识；',
      '朋友互动趣味🤝：和朋友一起解读生辰，增添社交互动的乐趣；',
      '自我认知探索💡：通过生辰命理分析，从新角度了解自己的性格特质。',
    ],
    promptParts: [
      {
        text: '请提供你的出生信息：出生日期（公历）：____年____月____日，出生时间：____时____分，出生地点（用于真太阳时校正）：____（我将为你排出八字命盘，包含：四柱八字（年柱、月柱、日柱、时柱）、五行分布（金木水火土占比）、日主与十神关系、命盘简析（旺衰、喜忌）',
      },
    ],
  },
  {
    id: 'mbti-match',
    categoryId: 'fun',
    icon: '💞',
    title: 'MBTI 配对分析',
    subtitle: '想知道合不合？帮你分析性格契合度',
    scenarios: [
      '恋爱相处好奇👩‍❤️‍👨：分析与伴侣的契合度、相处模式与注意点；',
      '友情维系探索🤝：了解与朋友是否合拍，相处更融洽；',
      '职场合作考量💼：判断与同事或合作方的配合度，提升协作效率。',
    ],
    promptParts: [
      {
        text: '进行 MBTI 配对分析：请告诉我：A 方的 MBTI（你）：____；B 方的 MBTI（TA）：____；关系类型：爱情 / 友情 / 合作 / 其他',
      },
    ],
  },
  {
    id: 'movie-helper',
    categoryId: 'life',
    icon: '🍿',
    title: '影视推荐小助手',
    subtitle: '周末不知道看啥？按口味精准推荐，片源直接给到',
    scenarios: [
      '周末放松🛋️：不知道看什么，想要一个靠谱的推荐。',
      '约会之夜💑：需要找一部适合两个人一起看的电影。',
      '发现佳片🎬：想探索某个导演的作品或某类小众题材。',
    ],
    promptParts: [
      { text: '帮我查一下' },
      { text: '「奥本海默」', highlight: true },
      { text: '的详细信息和在哪个平台可以看。' },
    ],
  },
  {
    id: 'cron-exercise-tomorrow',
    categoryId: 'fitness',
    icon: '🏀',
    title: '定时任务：明日运动计划',
    subtitle: '想运动又怕坚持不下来？每天帮你排好计划，到点喊你动起来',
    scenarios: [
      '健身打卡难坚持💪：想运动却无规划，量身定制运动计划，到点督促执行；',
      '日常运动无序⏰：不知道何时运动、做什么运动，科学规划时间与项目，提升运动效果。',
    ],
    promptParts: [
      { text: '设置每日' },
      { text: '「22:00」', highlight: true },
      { text: '的自动定时任务，根据明天' },
      { text: '「深圳南山」', highlight: true },
      {
        text: '的天气、每小时气温变化与日期，为我量身定制明天人性化的「运动计划」。',
      },
    ],
  },
  {
    id: 'daily-food',
    categoryId: 'life',
    icon: '🍜',
    title: '每日吃什么推荐',
    subtitle: '饭点不知道吃啥？报口味定位，健康餐单连店带路喂到嘴边。',
    scenarios: [
      '饭点选择困难😋：到饭点不知道吃什么，根据口味推荐健康餐单，告别纠结；',
      '出门干饭迷茫📍：不知道周边有什么好吃的，附带商家地址和路线，干饭更便捷。',
    ],
    promptParts: [
      { text: '我' },
      { text: '【晚上】', highlight: true },
      { text: '想吃一顿' },
      { text: '【不是太寡淡的健康餐】', highlight: true },
      { text: '，帮我推荐一份饮食清单。并且找到距离我最近的商家店铺地址和路线，我在' },
      { text: '【深圳南山区腾讯大厦】', highlight: true },
      { text: '。' },
    ],
  },
  {
    id: 'exercise-adjust',
    categoryId: 'fitness',
    icon: '🏋️',
    title: '锻炼任务调整',
    subtitle: '锻炼计划乱了？帮你重新安排锻炼节奏',
    scenarios: [
      '突发情况断练🚫：加班/有事无法按原计划锻炼，快速生成平替运动方案；',
      '运动计划不适🏃：原锻炼计划难度过高/过低，重新调整节奏，适配自身状态；',
      '日常时间冲突⏰：生活工作占用运动时间，根据剩余时间定制合适的锻炼内容。',
    ],
    promptParts: [
      { text: '我今天' },
      { text: '「加班到22:00，去不了健身房了。」', highlight: true },
      {
        text: '根据之前的目标和当前的情况和时间，给我输出一份平替的运动方案文档，播放对应的跟练视频或者教程，最后更新当前的日程。',
      },
    ],
  },
]

export function flattenPromptParts(parts: PromptPart[]): string {
  return parts.map((p) => p.text).join('')
}

export function filterItemsByCategory(
  items: InspirationItem[],
  categoryId: InspirationCategoryId | 'all',
): InspirationItem[] {
  if (categoryId === 'all') return items
  return items.filter((i) => i.categoryId === categoryId)
}

