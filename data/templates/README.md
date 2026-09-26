# 识别模板库目录

## 目录用途

本目录存放**棋子识别模板**（每张 = 一个 64×64 RGBA 图 + pHash/dHash 指纹）。

## 版权合规（重要）

本项目**不内置任何图鉴站/官方美术素材**。这里的 `*.json` 有两种来源：

| `source` 字段 | 含义 | 用途 |
| --- | --- | --- |
| `placeholder` | 由 `npm run make:templates` 生成的**确定性合成图**（底色 = 该费用档参考色 + 哈希色块） | 让识别链路在真实素材到位前可跑通、可演示、可单测 |
| `user` | 用户通过应用内「模板管理 → 采集向导」或 `--from` 模式，把**自己截的游戏画面**切下来 | 真实识别使用 |

占位模板的识别价值有限（只保证"不同弈子 pHash 可区分 + 费用先验可验证"），
真实准确率必须靠用户自建素材（PRD Q4/Q6）。

## 文件格式

文件名：`<cost>-<championId>-<序号>.json`

```json
{
  "championId": "ahri",
  "size": 64,
  "channels": 4,
  "fingerprint": "a1b2c3d4e5f60718",
  "dHash": "0123456789abcdef",
  "dataBase64": "<64*64*4 字节 RGBA 的 base64>",
  "source": "placeholder"
}
```

加载器只认 `*.json`，文件名不参与解析（更健壮）；`index.json` 是生成器写的指纹清单，
不是模板，会被加载器忽略（其 `championId` 字段缺失）。

## 常用命令

```bash
# 生成/刷新占位模板（65 弈子 × 1 变体）
npm run make:templates

# 先清空再生成
npm run make:templates -- --clean

# 用自己截的图建一张真实模板（居中裁方形 → 64×64）
npm run make:templates -- --from shot.png --champion ahri
```

## 实际生效的目录

应用运行期读取的是 `AppConfig.data.templateDir`（默认 `<userData>/assets/templates`）。
把本目录的模板迁移过去有两种方式：

1. 应用内「模板管理 → 导入 zip」；
2. 或直接用 `--out` 指定运行期目录重跑生成器：

```bash
npm run make:templates -- --out "%APPDATA%/tft-pool-counter/assets/templates"
```
