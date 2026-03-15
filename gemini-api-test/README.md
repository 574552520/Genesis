# Gemini 3.0 Image Pro API 测试工具

完整的 Gemini 图片生成 API 参数文档和测试工具，支持所有官方参数配置和测试。

## 功能特性
- ✅ 支持所有官方 API 参数配置
- ✅ 可视化界面参数选择
- ✅ 自动请求发送和结果展示
- ✅ 参数验证和错误提示
- ✅ 历史请求记录

## API 参数说明

### 1. 基础参数
| 参数名 | 类型 | 可选值 | 默认值 | 说明 |
|--------|------|--------|--------|------|
| `model` | string | `gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview` | `gemini-3-pro-image-preview` | 选择使用的模型 |
| `apiKey` | string | - | - | API 密钥 |
| `apiEndpoint` | string | - | `https://lingkeapi.com` | API 端点地址 |

### 2. 生成配置 (generationConfig)
| 参数名 | 类型 | 可选值 | 默认值 | 说明 |
|--------|------|--------|--------|------|
| `responseModalities` | array | `["TEXT", "IMAGE"]`, `["IMAGE"]`, `["TEXT"]` | `["TEXT", "IMAGE"]` | 响应类型 |
| `temperature` | number | 0.0 - 1.0 | 0.7 | 生成创造性，值越高越有创意 |
| `topP` | number | 0.0 - 1.0 | 0.95 | 核采样概率 |
| `topK` | integer | 1 - 100 | 40 |  top-k 采样 |
| `maxOutputTokens` | integer | 1 - 8192 | 2048 | 最大输出令牌数 |

### 3. 图片配置 (imageConfig)
| 参数名 | 类型 | 可选值 | 默认值 | 说明 |
|--------|------|--------|--------|------|
| `aspectRatio` | string | `1:1`, `16:9`, `9:16`, `4:3`, `3:4` | `16:9` | 图片宽高比 |
| `imageSize` | string | `512x512`, `1K`, `2K`, `4K` | `1K` | 图片分辨率 |
| `quality` | string | `STANDARD`, `HIGH` | `STANDARD` | 生成质量 |
| `numberOfImages` | integer | 1 - 4 | 1 | 生成图片数量 |
| `addWatermark` | boolean | `true`, `false` | `false` | 是否添加水印 |
| `outputMimeType` | string | `image/png`, `image/jpeg`, `image/webp` | `image/png` | 输出图片格式 |
| `personGeneration` | string | `ALLOW_ALL`, `BLOCK_ADULT`, `BLOCK_ALL` | `ALLOW_ALL` | 人像生成控制 |
| `enhanceFaces` | boolean | `true`, `false` | `false` | 是否增强面部特征 |
| `preserveIdentity` | boolean | `true`, `false` | `false` | 是否保留参考图片的身份特征 |

### 4. 安全设置 (safetySettings)
| 危害类别 | 阈值选项 | 默认值 | 说明 |
|----------|----------|--------|------|
| `HARM_CATEGORY_HARASSMENT` | `BLOCK_NONE`, `BLOCK_ONLY_HIGH`, `BLOCK_MEDIUM_AND_ABOVE`, `BLOCK_LOW_AND_ABOVE` | `BLOCK_MEDIUM_AND_ABOVE` | 骚扰内容 |
| `HARM_CATEGORY_HATE_SPEECH` | 同上 | `BLOCK_MEDIUM_AND_ABOVE` | 仇恨言论 |
| `HARM_CATEGORY_SEXUALLY_EXPLICIT` | 同上 | `BLOCK_MEDIUM_AND_ABOVE` | 性暗示内容 |
| `HARM_CATEGORY_DANGEROUS_CONTENT` | 同上 | `BLOCK_MEDIUM_AND_ABOVE` | 危险内容 |

### 5. 内容参数
| 参数名 | 类型 | 说明 |
|--------|------|------|
| `prompt` | string | 生成提示词 |
| `referenceImages` | array | 参考图片 URL 或 Base64 数据 |
| `systemPrompt` | string | 系统提示词，用于设置生成风格 |

## 使用方法

### 1. 安装依赖
```bash
cd gemini-api-test
npm install
```

### 2. 配置环境变量
复制 `.env.example` 为 `.env` 并填写你的 API 密钥：
```
LINGKE_API_KEY=your_api_key_here
LINGKE_API_BASE_URL=https://lingkeapi.com
```

### 3. 启动测试界面
```bash
npm run dev
```

### 4. 运行命令行测试
```bash
node test-api.js
```

## 请求示例

### 基础图片生成
```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "A beautiful sunset over the ocean"
        }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["IMAGE"],
    "imageConfig": {
      "aspectRatio": "16:9",
      "imageSize": "2K",
      "quality": "HIGH"
    }
  }
}
```

### 带参考图片的人像生成
```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "inline_data": {
            "mime_type": "image/jpeg",
            "data": "base64_encoded_image_data"
          }
        },
        {
          "text": "Make this person wear a suit in a business office setting"
        }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["IMAGE"],
    "imageConfig": {
      "aspectRatio": "9:16",
      "personGeneration": "ALLOW_ALL",
      "preserveIdentity": true,
      "enhanceFaces": true
    }
  },
  "safetySettings": [
    {
      "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
      "threshold": "BLOCK_NONE"
    }
  ]
}
```

## 官方文档参考
- [Gemini API 图片生成指南](https://ai.google.dev/gemini-api/docs/image-generation)
- [Gemini API 参考文档](https://ai.google.dev/api/generate-content)