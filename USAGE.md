# Wiz-War 使用说明

## 快速开始

### 安装依赖
```bash
npm install
```

### 启动开发服务器
```bash
npm run dev
```
然后在浏览器打开显示的 URL（通常是 http://localhost:5173）

### 运行测试
```bash
npm test
```

### 类型检查
```bash
npm run typecheck
```

### 生产构建
```bash
npm run build
```

## 游戏设置

### 创建新游戏
1. 打开应用后看到设置界面
2. 选择玩家数量（2-4人）
3. 为每个座位选择人类(H)或机器人(B)
4. 选择 3 个学派（从 6 个可选学派中选 3 个）
5. 点击 "Start Game"

### 学派说明
- **Cantrip**: 基础法术，包含各种实用效果
- **Alchemy**: 炼金术，石头和药水相关
- **Conjuring**: 召唤术，创造物体和陷阱
- **Elemental**: 元素魔法，火水土风
- **Mentalism**: 心灵魔法，精神攻击和防御
- **Mutation**: 变形术，改变形态和能力
- **Thaumaturgy**: 奥术，高级魔法效果

## 游戏操作

### 回合流程
每个玩家回合分为三个阶段：

1. **Time Passes** (自动)
   - 处理持续效果
   - 减少维护法术能量

2. **Move & Cast** (玩家操作)
   - 有 3 点 MP（魔法点）
   - 可以：
     - 移动（消耗 1 MP）
     - 出拳攻击（消耗 1 MP，每回合一次）
     - 施放法术（消耗 1 MP）
     - 使用物品
   - 点击 "End Turn" 结束阶段

3. **Discard & Draw** (玩家操作)
   - 弃掉多余的牌（手牌上限 7 张）
   - 抽牌补充手牌
   - 点击 "End Turn" 进入下一玩家

### 棋盘操作
- **点击格子**: 选择移动目标或施法目标
- **高亮格子**: 显示可行动的格子
- **黄色边框**: 当前玩家位置

### 卡牌使用
- **点击手牌**: 选择要使用的卡牌
- **点击目标**: 为卡牌选择目标
- **能量卡牌**: 可以附加到法术增加威力

## AI 对战

### 运行模拟器
```bash
# 使用启发式AI
npm run sim

# 使用进化AI
npm run sim -- --evolving

# 指定随机种子
npm run sim -- 123
```

### 输出示例
```
Running simulation with seed 42...
Using evolving bots
Winner: blue
Turns: 156
Log entries: 312
Last 10 log entries:
  Turn 156: blue wizard's turn
  blue wizard punches red wizard
  ...
```

## AI 进化

### 运行进化
```bash
# 基本用法（10代，20个体）
npx tsx src/headless/evolve.ts

# 自定义参数（代数，种群大小）
npx tsx src/headless/evolve.ts 20 50

# 更多代数和更大种群
npx tsx src/headless/evolve.ts 50 100
```

### 进化参数
- **代数**: 进化的轮数，越多越好但越慢
- **种群大小**: 每代的AI数量，越大搜索空间越大
- **变异率**: 默认 0.1，控制参数变化幅度
- **变异强度**: 默认 0.2，控制参数变化范围

### 输出说明
```
=== Generation 1 ===
Avg fitness: 1.10
Best fitness: 6
Best params: {
  "aggression": 0.54,
  "defense": 0.57,
  "treasureSeek": 0.39,
  ...
}
```

- **Avg fitness**: 平均适应度
- **Best fitness**: 最佳适应度
- **Best params**: 最佳AI的参数

### 保存的参数
进化完成后，最佳AI的参数会保存到 `evolved-params.json`

## 棋盘数据

### 数据来源
棋盘拓扑数据来自 `work/board-data.json`，包含：
- 4 个颜色扇区（蓝、红、黄、绿）
- 每个扇区 5x5 网格
- 墙壁、门、地形信息

### 数据格式
```json
{
  "faces": {
    "blue": {
      "front": [[{...}, ...], ...],
      "back": [[{...}, ...], ...]
    },
    ...
  },
  "portals": []
}
```

## 常见问题

### Q: 游戏卡住了怎么办？
A: 刷新页面重新开始。如果是AI对战卡住，检查终端是否有错误信息。

### Q: 如何添加新卡牌？
A: 编辑 `src/core/cards/data/*.json` 文件，添加新的卡牌定义。

### Q: 如何修改AI策略？
A: 编辑 `src/core/ai/evolving.ts` 中的 `scoreAction` 方法。

### Q: 如何调整棋盘大小？
A: 修改 `src/core/board.ts` 中的 `SECTOR_SIZE` 和 `BOARD_SIZE` 常量。

## 故障排除

### 构建失败
```bash
# 清理并重新安装
rm -rf node_modules package-lock.json
npm install
npm run build
```

### 测试失败
```bash
# 运行单个测试文件
npx vitest run tests/core/board.test.ts

# 监视模式
npm run test:watch
```

### 端口被占用
```bash
# 使用不同端口
npm run dev -- --port 3000
```