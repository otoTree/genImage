# Cloubic Client Curl 示例

## 基础信息

- 基础地址：`https://api.cloubic.com/v1`
- 鉴权头：`Authorization: Bearer $CLOUBIC_API_KEY`
- 代码来源：`src/infrastructure/ai/cloubic-client.ts`
- 默认模型：
  - 文本：`gpt-4o`
  - 图片：`gemini-3-pro-image-preview`
  - 视频：`kling-v3-omni-pro`

可先在终端设置环境变量：

```bash
export CLOUBIC_BASE_URL="https://api.cloubic.com/v1"
export CLOUBIC_API_KEY="your-cloubic-api-key"
```

## 1. 文本生成

对应实现：`generateTextWithCloubic`

### 1.1 纯文本请求

```bash
curl --request POST "$CLOUBIC_BASE_URL/chat/completions" \
  --header "Authorization: Bearer $CLOUBIC_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "model": "gpt-4o",
    "messages": [
      {
        "role": "system",
        "content": "你是一个专业的内容创作助手。"
      },
      {
        "role": "user",
        "content": "请帮我写一段夏季连衣裙电商主图文案。"
      }
    ],
    "temperature": 0.7
  }'
```

响应示例：

```json
{
  "id": "chatcmpl_123",
  "object": "chat.completion",
  "created": 1775000000,
  "model": "gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "这款夏季连衣裙采用轻盈面料与利落剪裁，带来清爽、优雅且适合日常通勤与假日出行的穿搭体验。"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 36,
    "completion_tokens": 42,
    "total_tokens": 78
  }
}
```

### 1.2 带参考图的文本请求

当 `referenceImages` 非空时，代码会把 `user.content` 组装成多模态数组：

```bash
curl --request POST "$CLOUBIC_BASE_URL/chat/completions" \
  --header "Authorization: Bearer $CLOUBIC_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "model": "gpt-4o",
    "messages": [
      {
        "role": "system",
        "content": "你是一个专业的内容创作助手。"
      },
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "请结合参考图输出一段产品卖点文案。"
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://example.com/reference-1.png"
            }
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://example.com/reference-2.png"
            }
          }
        ]
      }
    ],
    "temperature": 0.7,
    "response_format": {
      "type": "json_object"
    }
  }'
```

响应示例：

```json
{
  "id": "chatcmpl_124",
  "model": "gpt-4o",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "{\"headline\":\"轻盈透气，适合夏日通勤\",\"selling_points\":[\"低饱和清新配色\",\"面料垂顺不闷热\",\"适合日常与约会场景\"]}"
      }
    }
  ],
  "usage": {
    "prompt_tokens": 128,
    "completion_tokens": 57,
    "total_tokens": 185
  }
}
```

## 2. 图片生成

对应实现：`generateImageWithCloubic`

代码同样使用 `/chat/completions`，并要求返回内容里能提取出图片地址或 Data URI。当前实现会优先从 `choices[0].message.content` 中提取 Markdown 图片、URL、JSON 字段或 Data URI。

### 2.1 纯文本出图

```bash
curl --request POST "$CLOUBIC_BASE_URL/chat/completions" \
  --header "Authorization: Bearer $CLOUBIC_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "model": "gemini-3-pro-image-preview",
    "messages": [
      {
        "role": "user",
        "content": "请生成一张夏季连衣裙电商棚拍主图，纯色背景，柔和自然光。"
      }
    ],
    "n": 1
  }'
```

响应示例：

```json
{
  "id": "chatcmpl_img_001",
  "model": "gemini-3-pro-image-preview",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "![generated-image](https://cdn.example.com/generated/dress-main-001.png)"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 48,
    "completion_tokens": 109,
    "total_tokens": 157
  }
}
```

### 2.2 带参考图的图片请求

```bash
curl --request POST "$CLOUBIC_BASE_URL/chat/completions" \
  --header "Authorization: Bearer $CLOUBIC_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "model": "gemini-3-pro-image-preview",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "请基于参考图生成一张新图片，保留服装结构但改成更高级的品牌视觉。"
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://example.com/reference-dress.png"
            }
          }
        ]
      }
    ],
    "n": 1
  }'
```

响应示例：

```json
{
  "id": "chatcmpl_img_002",
  "model": "gemini-3-pro-image-preview",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "{\"imageUrl\":\"https://cdn.example.com/generated/dress-brand-002.png\"}"
      }
    }
  ],
  "usage": {
    "prompt_tokens": 91,
    "completion_tokens": 32,
    "total_tokens": 123
  }
}
```

## 3. 视频生成

对应实现：`generateVideoWithCloubic`

接口路径为 `/video/generations`。代码会根据模型名与 `settings` 自动拼装不同请求体。

### 3.1 默认 Omni 模型请求

当模型命中 `kling-v3-omni` 规则时，请求体会优先使用：

- 顶层 `image_url`
- 顶层 `end_image_url`
- `metadata.image_list`
- `metadata.multi_shot`
- `metadata.shot_type`
- `metadata.multi_prompt`

```bash
curl --request POST "$CLOUBIC_BASE_URL/video/generations" \
  --header "Authorization: Bearer $CLOUBIC_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "model": "kling-v3-omni-pro",
    "prompt": "一条浅色连衣裙在自然光下缓慢旋转展示，镜头由中景推近到面料细节。",
    "duration": 5,
    "image_url": "https://example.com/first-frame.png",
    "end_image_url": "https://example.com/last-frame.png",
    "metadata": {
      "multi_shot": false,
      "aspect_ratio": "9:16",
      "sound": "off",
      "image_list": [
        {
          "image_url": "https://example.com/reference-1.png"
        }
      ]
    }
  }'
```

响应示例：

```json
{
  "id": "video_task_001",
  "model": "kling-v3-omni-pro",
  "status": "pending"
}
```

### 3.2 非 Omni 多镜头请求

当模型不是 `kling-v3-omni`，且传入了 `shotPrompts` 或 `metadata.multi_prompt` 时，代码会走多镜头模式：

```bash
curl --request POST "$CLOUBIC_BASE_URL/video/generations" \
  --header "Authorization: Bearer $CLOUBIC_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "model": "kling-v3-master",
    "prompt": "生成模式：智能分镜视频。请基于完整分镜自动组织镜头切换、节奏与衔接。",
    "duration": 8,
    "image_url": "https://example.com/first-frame.png",
    "metadata": {
      "multi_shot": true,
      "aspect_ratio": "16:9",
      "sound": "on",
      "generation_mode": "multi_shot",
      "shot_type": "customize",
      "multi_prompt": [
        {
          "prompt": "镜头一：模特走入画面，展示整体穿搭。",
          "duration": 3
        },
        {
          "prompt": "镜头二：特写面料与裙摆细节。",
          "duration": 3
        },
        {
          "prompt": "镜头三：回到全景，定格品牌视觉。",
          "duration": 2
        }
      ],
      "image_list": [
        {
          "image_url": "https://example.com/first-frame.png"
        },
        {
          "image_url": "https://example.com/reference-2.png"
        }
      ],
      "images": [
        "https://example.com/first-frame.png",
        "https://example.com/reference-2.png"
      ]
    }
  }'
```

响应示例：

```json
{
  "task_id": "video_task_002",
  "data": {
    "status": "processing"
  }
}
```

说明：当前实现同时兼容以下字段来源：

- 任务 ID：`id`、`task_id`、`data.task_id`
- 状态：`status`、`data.status`

## 4. 视频任务查询

对应实现：`getVideoStatusWithCloubic`

```bash
curl --request GET "$CLOUBIC_BASE_URL/video/generations/video_task_001" \
  --header "Authorization: Bearer $CLOUBIC_API_KEY"
```

响应示例：

```json
{
  "id": "video_task_001",
  "status": "completed",
  "video_url": "https://cdn.example.com/generated/video-task-001.mp4",
  "progress": 100
}
```

兼容的另一种响应结构：

```json
{
  "data": {
    "status": "completed",
    "video_url": "https://cdn.example.com/generated/video-task-001.mp4",
    "progress": 100
  }
}
```

## 5. 代码提取要点

- 文本和图片都走：`POST /chat/completions`
- 视频提交走：`POST /video/generations`
- 视频查询走：`GET /video/generations/{providerTaskId}`
- 文本接口会在 `responseFormat === "json"` 时附带 `response_format: { "type": "json_object" }`
- 图片接口要求最终能从响应中提取出图片源，支持 Markdown 图片、普通 URL、JSON 字段、Data URI
- 视频接口会根据模型是否匹配 `kling-v3-omni` 生成不同的请求体结构
