主 Agent 規則 : 拆解任務、分配子Agent。
子 Agent 規則 ：
  - 不 build、不test、不typecheck。
- 早提交、早返回。

主 Agent 負責任務管理、衝突解決、測試和整合。拆分工作時，遵循工程管理技巧。調查優先，按覆蓋面拆分。
子 Agent worktree、中間編譯產物，必須及時清理。