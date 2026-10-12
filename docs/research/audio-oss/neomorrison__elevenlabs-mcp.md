# neomorrison/elevenlabs-mcp 源码审查

## 1. 一句话：它到底是什么

一个把 ElevenLabs Python SDK 直接包装成 28 个 stdio MCP 工具的单文件云端客户端；TTS/对话/克隆/音乐/音效/STT 等确有调用代码，但**不能原样作为安全、可审计的 AudioEngine；建议 Fork 最小改造后作 ElevenLabs BYOK 接口**。缺 key 被当作 MCP 成功文本、输出路径可越界，均已在不联网条件下复现。

## 2. 审查快照

审查 2026-10-11；https://github.com/neomorrison/elevenlabs-mcp ；目录 `/tmp/oss-audit/neomorrison__elevenlabs-mcp`；SHA `b966455014e1f51bb0aef2ac4119d05235fc6298`。以下相对源码证据均属此 SHA。`--depth 50` 克隆只有1提交、1作者；唯一提交日期 2026-06-30T18:02:27-07:00（UTC/台北为7月1日），因此最近10次实际仅1次。匿名 GitHub API：0 stars、0 forks、0 issue/PR，push=2026-07-01，未见测试目录或 CI workflow。无用户反馈不是无缺陷证明。

## 3. 架构（≤15行）

1. `src/elevenlabs_mcp/server.py:34` 启动时 load_dotenv。
2. 同文件创建 FastMCP，`:999` main 调 stdio mcp.run。
3. `@mcp.tool()` 注册28函数，`@catch` 包住SDK/文件异常。
4. `:55` 首次调用从环境取 ELEVENLABS_API_KEY 并缓存SDK客户端。
5. 生成函数→SDK迭代器→`:114` collect 全部 bytes→`:101` save_bytes。
6. 本地上传路径→require_file→SDK上传；结果json或文本返回。
7. dubbing返回云job ID，另有查状态/下载工具；其余多数同步。
8. 账户/voice/history数据来自云API，无本地持久任务/用量/声线账本。

## 4. 真实已实现功能表

路径缩写 `server.py` 下表均指 `src/elevenlabs_mcp/server.py`。

| 功能 | 证据 | 状态 |
|---|---|---|
| stdio MCP启动/发现28工具 | `server.py:999`；真实ClientSession initialize/tools/list，协议2025-11-25 | 已验证运行 |
| 缺key失败处理 | `server.py:55`、`:167`；list_voices/text_to_speech返回ERROR但isError=false | 已验证运行；协议错误语义需修 |
| TTS/多角色对话/变声 | `server.py:188`、`:244`、`:273`，SDK convert | 源码完整未运行；需key |
| 音效/音频清理/音乐 | `server.py:311`、`:346`、`:365` | 源码完整未运行；需key |
| STT/强制对齐 | `server.py:401`、`:439` | 源码完整未运行；需key |
| 声线设计/保存preview/克隆 | `server.py:462`、`:516`、`:541` | 源码完整未运行；克隆无consent验证 |
| 声线查询/搜索/设置/删除/模型查询 | `server.py:585`、`:614`、`:629`、`:677`、`:685`、`:722`、`:740` | 源码完整未运行；查询亦需key |
| 账户/订阅/usage/历史操作 | `server.py:760`、`:768`、`:782`、`:821`、`:859`、`:871`、`:888` | 源码完整未运行；非本地账本 |
| dubbing提交/状态/下载 | `server.py:906`、`:962`、`:974` | 源码完整未运行；云job ID，无本地取消恢复 |
| 文件输出 | `server.py:101`；5字节audit内容用../文件名实际越出输出目录 | 已验证运行；允许覆盖且无边界 |
| keychain/预算/价格确认/本地模型/Provider路由 | 源码无这些路径 | 不支持 |

## 5. MCP

使用 Python `mcp[cli]>=1.9.0` FastMCP，默认 stdio；没有启用HTTP的源码配置。`uv.lock:470`锁1.28.1；宽版本安装本次解析1.30.0，真实握手在1.30.0通过。可以用标准 MCP 客户端指定独立venv解释器/console script接 Claude Code、Codex、Cursor；本次未编辑任何客户端配置。

以下为**实际 tools/list schema**参数，不是README摘要；`*`是必需参数，其他均可选，默认值显示在括号中。完整schema临时证据 `/tmp/oss-audit/elevenlabs-mcp-mcp.json`；源码函数起始行作为证据。工具返回文字或JSON文字，不返回统一job/asset结构。

| 工具（源码起始行） | 参数 |
|---|---|
| text_to_speech (`server.py:188`) | **text***:string; voice_id:string/null=null; model_id:string/null=null; output_format:string="mp3_44100_128"; language_code:string/null=null; stability:number/null=null; similarity_boost:number/null=null; style:number/null=null; use_speaker_boost:boolean/null=null; speed:number/null=null; seed:integer/null=null; output_filename:string/null=null |
| text_to_dialogue (`server.py:244`) | **dialogue***:array<object>; model_id:string/null=null; output_format:string="mp3_44100_128"; output_filename:string/null=null |
| speech_to_speech (`server.py:273`) | **audio_file_path***:string; voice_id:string/null=null; model_id:string/null=null; output_format:string="mp3_44100_128"; remove_background_noise:boolean/null=null; output_filename:string/null=null |
| sound_effects (`server.py:311`) | **text***:string; duration_seconds:number/null=null; prompt_influence:number/null=null; loop:boolean/null=null; output_format:string="mp3_44100_128"; output_filename:string/null=null |
| audio_isolation (`server.py:346`) | **audio_file_path***:string; output_filename:string/null=null |
| compose_music (`server.py:365`) | **prompt***:string; music_length_ms:integer/null=null; model_id:string/null=null; output_format:string="mp3_44100_128"; output_filename:string/null=null |
| speech_to_text (`server.py:401`) | **audio_file_path***:string; model_id:string="scribe_v1"; language_code:string/null=null; diarize:boolean/null=null; tag_audio_events:boolean/null=null; num_speakers:integer/null=null |
| forced_alignment (`server.py:439`) | **audio_file_path***:string; **text***:string |
| design_voice (`server.py:462`) | **voice_description***:string; text:string/null=null; model_id:string/null=null; auto_generate_text:boolean/null=null |
| create_voice_from_preview (`server.py:516`) | **voice_name***:string; **voice_description***:string; **generated_voice_id***:string |
| clone_voice (`server.py:541`) | **name***:string; **audio_file_paths***:array<string>; description:string/null=null; labels:object/null=null; remove_background_noise:boolean/null=null |
| list_voices (`server.py:585`) | search:string/null=null |
| get_voice (`server.py:614`) | **voice_id***:string |
| search_voice_library (`server.py:629`) | search:string/null=null; category:string/null=null; gender:string/null=null; language:string/null=null; page_size:integer=20 |
| get_default_voice_settings (`server.py:677`) | 无 |
| edit_voice_settings (`server.py:685`) | **voice_id***:string; stability:number/null=null; similarity_boost:number/null=null; style:number/null=null; use_speaker_boost:boolean/null=null; speed:number/null=null |
| delete_voice (`server.py:722`) | **voice_id***:string |
| list_models (`server.py:740`) | 无 |
| get_user_info (`server.py:760`) | 无 |
| check_subscription (`server.py:768`) | 无 |
| get_usage_stats (`server.py:782`) | start_unix:integer/null=null; end_unix:integer/null=null; metric:string="credits"; breakdown_type:string="none"; aggregation_interval:string="day" |
| list_history (`server.py:821`) | page_size:integer=20; voice_id:string/null=null; search:string/null=null |
| get_history_item (`server.py:859`) | **history_item_id***:string |
| download_history_audio (`server.py:871`) | **history_item_id***:string; output_filename:string/null=null |
| delete_history_item (`server.py:888`) | **history_item_id***:string |
| dub_audio (`server.py:906`) | **target_lang***:string; audio_file_path:string/null=null; source_url:string/null=null; source_lang:string/null=null; name:string/null=null; num_speakers:integer/null=null; watermark:boolean/null=null |
| get_dubbing_status (`server.py:962`) | **dubbing_id***:string |
| download_dubbed_audio (`server.py:974`) | **dubbing_id***:string; **language_code***:string; output_filename:string/null=null |

同名音频 output_format 表示供应商枚举（默认 mp3_44100_128）；output_filename 可控制文件名但当前未防止越界。输入文件路径为服务器本机路径，不是跨机器自动附件。delete_voice/delete_history_item会实际删除云资源，整合应限制暴露与授权。

## 6. 测试

仓库无自带测试/CI。本次额外在 `/tmp/oss-audit/audio-audit-venv` Python3.12.11 安装两项目并跑真实 stdio probe。进程环境去掉key、禁用dotenv；只调用 tools/list、list_voices、text_to_speech 的缺key路径，未发出付费请求。

```sh
/tmp/oss-audit/audio-audit-venv/bin/python /tmp/oss-audit/probe-mcp.py
# 28 tools; list_voices/text_to_speech: ERROR RuntimeError, isError=false
/tmp/oss-audit/audio-audit-venv/bin/python /tmp/oss-audit/sdk-bind.py
# 28工具对应SDK方法存在；非秘密sentinel原样出现在_err输出
```

另用AST收集SDK调用显式参数和kwargs赋值键，对 SDK 2.71.0 与锁定2.55.0分别 `inspect.signature(...).bind_partial(...)`：**30个调用点全部接受，零参数名不匹配**。客户端 `api_key=None`，MockTransport拒绝任何请求；该检查不验证参数值、云端模型可用性或结果。锁定MCP1.28.1未重新做完整握手；1.30.0握手已验。没有冒充实际云验收。

文件安全复验：`_save_bytes(b'audit','audit','mp3','../filename-test-escaped.mp3')` 在输出目录 `/tmp/oss-audit/filename-test-root` 配置下写到 `/private/tmp/oss-audit/filename-test-escaped.mp3`；只用无害5字节，未触碰用户数据。`_err(RuntimeError('AUDIT_NON_SECRET_SENTINEL'))` 不脱敏；这是缺少通用脱敏证据，不是发现真实key泄漏。完成后删除隔离venv，保存小型JSON证据。

## 7. 依赖与授权（三层）

源码 `LICENSE:1` MIT；未见单文件另加非商用声明。直接依赖来自 `pyproject.toml:26`，逐项读取公共PyPI元数据核对：

| 依赖 | 声明/锁定/本次 | 许可证 |
|---|---|---|
| elevenlabs | >=2.55.0；锁2.55.0；宽版本实测2.71.0，另做锁版参数检查 | MIT |
| mcp[cli] | >=1.9.0；锁1.28.1；握手1.30.0 | MIT |
| python-dotenv | >=1.0.0；本次1.2.4 | BSD-3-Clause |

无上限范围存在未来SDK/MCP兼容风险；表不等于完整extras/传递依赖SBOM。未在三项直接依赖发现AGPL/GPL/非商用。

| 模型/服务 | 权重许可证与gated | 商用/限制判断 |
|---|---|---|
| ElevenLabs TTS/STS/dialogue/music/sfx/Scribe/voice design/clone/dubbing | 云SDK调用；项目不下载本地权重，无HF模型卡可核验，不属于源码MIT授权 | 云服务、账户plan及声音使用权条款另管；没有可自部署的开源权重授权。**🔴不能声称MIT允许全部模型输出无条件商用**；营收/地域/用户量与具体plan未核实 |

无模型下载/许可接受。需要未来以所选账户plan和实时官方条款做商用资格确认，本次不虚构服务授权。克隆入口 `server.py:541` 没有保存同意证明，不能把供应商对用户的要求当成本地已经验证。

## 8. 平台与资源

Apple Silicon macOS：本次真实 Python stdio启动通过，无CUDA/MPS/MLX依赖；这是云客户端，不在本机跑模型。Windows：使用pathlib/open和Python入口，无硬依赖bash，源码预计可接，未实测Windows；默认Desktop/用户home与文件权限需部署核验（`server.py:74`）。Python>=3.10。

低内存：不需本地GPU或GB权重，但 `server.py:114` 将流全部join内存再写文件，长音频内存随结果大小增长；上传、批量克隆、长音乐无本地大小/时长硬限制。没有服务器资源峰值实测；代码可部署不能推导16GB长任务可靠。

## 9. 复用结论（逐功能）

| 功能 | 选择 | 必要改造 |
|---|---|---|
| ElevenLabs TTS/对话/音效/音乐/STT/对齐/变声 | Fork改造 | 保留SDK调用；修MCP异常语义、输出目录边界/覆盖、结果结构；流式落盘/大小限额；接外层费用确认与本地账本 |
| clone/design/save preview | Fork改造 | 明确consent与主体权利验证/持久记录；多文件用ExitStack避免中途open泄漏；保护voice管理权限 |
| stdio工具定义 | 直接依赖/参考 | SDK定义和schema可用；原服务整体不能原样当安全AudioEngine |
| 模型/voice/account查询 | Fork改造 | 只读工具可先用于BYOK PoC；不将cloud history当本地job ledger |
| 删除voice/history | 默认放弃暴露 | 若确需则明确授权/权限，不应给普通生成流程完整管理工具 |
| 本地模型/MultiProvider/许可注册/预算 | 放弃此项目承担 | 源码没有；用最小外层整合其他成熟服务，不扩写单供应商server |

## 10. 风险与未验证项

1. **高：路径越界/覆盖已复现。** `server.py:101` 拼接directory/name后直接write_bytes；Agent传绝对路径或../可能覆盖任意当前权限文件。Fork限定basename、resolved父目录、排他写；保留合法扩展名检查。
2. **高：错误被当成功已复现。** `server.py:167` 捕获异常返回ERROR文字；MCP isError=false，自动化可能把失败记录成生成成功。应抛ToolError或结构化失败，敏感原文不外传。
3. **高：缺本地费用/consent/key安全层。** `.env`读取和客户端JSON明文key方式不符合目标keychain/env-only约束；源码没有统一预算/价格预确认，克隆无同意记录。不得原样复用README配置范式。
4. **中：原始异常/日志缺脱敏保证。** `server.py:161`、`:167` 返回API错误body/异常str并logger.exception；未发现主动打印key，但上游响应与堆栈不受脱敏保护。
5. **中：资源与SDK版本。** 音频全缓冲；无重启job账本/统一取消/失败重试策略。宽依赖未来可能解析新MCP主版本；优先固定lock并补离线测试。
6. 未验证任何云端成功、计费、免费额度、输出音质、模型/voice可用性、Windows、真实长音频、云job恢复。唯一可复验的小例子：无key启动后调用list_voices，应看到ERROR文本但isError=false；修复后必须改为isError=true，不能只美化错误文字。
