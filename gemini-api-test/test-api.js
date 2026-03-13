#!/usr/bin/env node
/**
 * Gemini 3.0 Image Pro API 命令行测试脚本
 * 支持所有官方参数配置，可用于批量测试和自动化测试
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

// 加载环境变量
require('dotenv').config({ path: path.join(__dirname, '.env') });

const defaultConfig = {
  apiKey: process.env.LINGKE_API_KEY || '',
  apiEndpoint: process.env.LINGKE_API_BASE_URL || 'https://lingkeapi.com',
  model: 'gemini-3-pro-image-preview',
  prompt: 'A beautiful sunset over the ocean',
  aspectRatio: '16:9',
  imageSize: '1K',
  quality: 'STANDARD',
  numberOfImages: 1,
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  responseModalities: ['TEXT', 'IMAGE'],
  addWatermark: false,
  outputMimeType: 'image/png',
  personGeneration: 'ALLOW_ALL',
  enhanceFaces: false,
  preserveIdentity: false,
  safetySettings: {
    harassment: 'BLOCK_MEDIUM_AND_ABOVE',
    hateSpeech: 'BLOCK_MEDIUM_AND_ABOVE',
    sexual: 'BLOCK_MEDIUM_AND_ABOVE',
    dangerous: 'BLOCK_MEDIUM_AND_ABOVE'
  },
  referenceImages: [],
  systemPrompt: '',
  outputDir: './output'
};

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const config = { ...defaultConfig };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      
      if (value && !value.startsWith('--')) {
        // 处理布尔值
        if (value === 'true' || value === 'false') {
          config[key] = value === 'true';
        }
        // 处理数字
        else if (!isNaN(value) && value !== '') {
          config[key] = Number(value);
        }
        // 处理数组
        else if (value.includes(',')) {
          config[key] = value.split(',').map(v => v.trim());
        }
        // 处理对象（安全设置）
        else if (key.startsWith('safety.')) {
          const safetyKey = key.split('.')[1];
          config.safetySettings[safetyKey] = value;
        }
        // 普通字符串
        else {
          config[key] = value;
        }
        i++;
      } else {
        // 布尔标志
        config[key] = true;
      }
    }
  }

  return config;
}

// 下载参考图片并转换为 Base64
async function loadReferenceImage(imagePathOrUrl) {
  if (imagePathOrUrl.startsWith('http')) {
    // 远程 URL
    return new Promise((resolve, reject) => {
      const url = new URL(imagePathOrUrl);
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to fetch image: ${response.statusCode}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const mimeType = response.headers['content-type'] || 'image/jpeg';
          resolve({
            inline_data: {
              mime_type: mimeType,
              data: buffer.toString('base64')
            }
          });
        });
      }).on('error', reject);
    });
  } else {
    // 本地文件
    const buffer = fs.readFileSync(imagePathOrUrl);
    const ext = path.extname(imagePathOrUrl).toLowerCase();
    const mimeType = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp'
    }[ext] || 'image/jpeg';
    
    return {
      inline_data: {
        mime_type: mimeType,
        data: buffer.toString('base64')
      }
    };
  }
}

// 构建请求体
async function buildRequestBody(config) {
  const parts = [];

  // 加载参考图片
  for (const img of config.referenceImages) {
    if (img) {
      try {
        const part = await loadReferenceImage(img);
        parts.push(part);
      } catch (error) {
        console.warn(`⚠️  无法加载参考图片 ${img}:`, error.message);
      }
    }
  }

  // 添加提示词
  parts.push({ text: config.prompt });

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: parts
      }
    ],
    generationConfig: {
      responseModalities: config.responseModalities,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      imageConfig: {
        aspectRatio: config.aspectRatio,
        imageSize: config.imageSize,
        quality: config.quality,
        numberOfImages: config.numberOfImages,
        addWatermark: config.addWatermark,
        outputMimeType: config.outputMimeType,
        personGeneration: config.personGeneration,
        enhanceFaces: config.enhanceFaces,
        preserveIdentity: config.preserveIdentity
      }
    },
    safetySettings: [
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: config.safetySettings.harassment
      },
      {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: config.safetySettings.hateSpeech
      },
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: config.safetySettings.sexual
      },
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: config.safetySettings.dangerous
      }
    ]
  };

  // 添加系统提示词
  if (config.systemPrompt) {
    requestBody.systemInstruction = {
      parts: [
        { text: config.systemPrompt }
      ]
    };
  }

  return requestBody;
}

// 发送 API 请求
async function sendRequest(config, requestBody) {
  const url = new URL(`${config.apiEndpoint.replace(/\/$/, '')}/v1beta/models/${config.model}:generateContent?key=${encodeURIComponent(config.apiKey)}`);

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    timeout: 120000 // 2 分钟超时
  };

  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString();
        try {
          const data = JSON.parse(responseBody);
          if (res.statusCode >= 400) {
            reject(new Error(`API Error ${res.statusCode}: ${JSON.stringify(data, null, 2)}`));
          } else {
            resolve(data);
          }
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${responseBody}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(JSON.stringify(requestBody));
    req.end();
  });
}

// 保存生成的图片
function saveImages(response, config) {
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }

  const parts = response.candidates?.[0]?.content?.parts || [];
  const savedFiles = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const base64 = part.inlineData?.data ?? part.inline_data?.data;
    const mimeType = part.inlineData?.mimeType ?? part.inline_data?.mime_type;

    if (base64 && mimeType) {
      const ext = mimeType.split('/')[1];
      const filename = `generated-${Date.now()}-${i + 1}.${ext}`;
      const filePath = path.join(config.outputDir, filename);
      
      const buffer = Buffer.from(base64, 'base64');
      fs.writeFileSync(filePath, buffer);
      savedFiles.push(filePath);
      console.log(`✅ 图片已保存: ${filePath}`);
    } else if (part.text) {
      const filename = `response-${Date.now()}-${i + 1}.txt`;
      const filePath = path.join(config.outputDir, filename);
      fs.writeFileSync(filePath, part.text, 'utf8');
      savedFiles.push(filePath);
      console.log(`✅ 响应文本已保存: ${filePath}`);
    }
  }

  return savedFiles;
}

// 打印帮助信息
function printHelp() {
  console.log(`
Gemini 3.0 Image Pro API 测试工具

使用方法:
  node test-api.js [选项]

选项:
  --apiKey <string>        API 密钥 (默认从环境变量 LINGKE_API_KEY 读取)
  --apiEndpoint <string>   API 端点 (默认: https://lingkeapi.com)
  --model <string>         模型名称 (默认: gemini-3-pro-image-preview)
  --prompt <string>        生成提示词 (默认: "A beautiful sunset over the ocean")
  --aspectRatio <string>   宽高比: 1:1, 16:9, 9:16, 4:3, 3:4 (默认: 16:9)
  --imageSize <string>     图片尺寸: 512x512, 1K, 2K, 4K (默认: 1K)
  --quality <string>       生成质量: STANDARD, HIGH (默认: STANDARD)
  --numberOfImages <number> 生成图片数量: 1-4 (默认: 1)
  --temperature <number>   温度值: 0.0-1.0 (默认: 0.7)
  --topP <number>          Top P: 0.0-1.0 (默认: 0.95)
  --topK <number>          Top K: 1-100 (默认: 40)
  --responseModalities <string> 响应类型, 逗号分隔: TEXT,IMAGE (默认)
  --addWatermark <boolean> 是否添加水印: true/false (默认: false)
  --outputMimeType <string> 输出格式: image/png, image/jpeg, image/webp (默认: image/png)
  --personGeneration <string> 人像生成控制: ALLOW_ALL, BLOCK_ADULT, BLOCK_ALL (默认: ALLOW_ALL)
  --enhanceFaces <boolean> 是否增强面部: true/false (默认: false)
  --preserveIdentity <boolean> 是否保留身份特征: true/false (默认: false)
  --safety.harassment <string> 骚扰内容阈值: BLOCK_NONE, BLOCK_ONLY_HIGH, BLOCK_MEDIUM_AND_ABOVE, BLOCK_LOW_AND_ABOVE
  --safety.hateSpeech <string> 仇恨言论阈值
  --safety.sexual <string> 性暗示内容阈值
  --safety.dangerous <string> 危险内容阈值
  --referenceImages <string> 参考图片, 逗号分隔的路径或 URL
  --systemPrompt <string>  系统提示词
  --outputDir <string>     输出目录 (默认: ./output)
  --dry-run                仅打印请求体, 不发送请求
  --help                   显示帮助信息

示例:
  # 基础生成
  node test-api.js --prompt "A cute cat" --aspectRatio "1:1" --imageSize "2K"

  # 带参考图片的人像生成
  node test-api.js --prompt "Make this person wear a suit" --referenceImages "portrait.jpg" --preserveIdentity true --enhanceFaces true

  # 调整安全设置
  node test-api.js --prompt "Artistic nude photography" --safety.sexual BLOCK_NONE --safety.dangerous BLOCK_NONE
`);
}

// 主函数
async function main() {
  if (process.argv.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  const config = parseArgs();

  if (!config.apiKey) {
    console.error('❌ 错误: 缺少 API 密钥，请设置 LINGKE_API_KEY 环境变量或使用 --apiKey 参数');
    process.exit(1);
  }

  try {
    console.log('🔧 正在构建请求体...');
    const requestBody = await buildRequestBody(config);

    console.log('\n📤 请求体:');
    console.log(JSON.stringify(requestBody, null, 2));

    if (process.argv.includes('--dry-run')) {
      console.log('\n✅ 运行结束（仅预览模式）');
      process.exit(0);
    }

    console.log('\n🚀 正在发送请求...');
    const response = await sendRequest(config, requestBody);

    console.log('\n📥 响应数据:');
    console.log(JSON.stringify(response, null, 2));

    console.log('\n💾 正在保存结果...');
    const savedFiles = saveImages(response, config);

    console.log(`\n🎉 请求完成！共生成 ${savedFiles.length} 个文件`);

  } catch (error) {
    console.error('\n❌ 错误:', error.message);
    process.exit(1);
  }
}

// 运行
main();