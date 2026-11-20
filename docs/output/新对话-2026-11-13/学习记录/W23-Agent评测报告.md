# W23 工单评测报告

诊断样本冻结为十道分类题、一条不可信历史和一条跨用户请求。每题记录正确类别、可用工具和预期授权。另用真实工单操作录制八种业务事件，以 actor、action、前后状态和版本校验。两类题分别保留分母。

在手写工程的 apps/server 中运行 `pnpm exec tsx test/evaluation/workflow-gate.ts test/evaluation/workflow-recording.json`。将 offer 样本的事件数组追加一次人工接入事件后复跑，预期退出 1，失败题为 offer。跨公司读取和未经批准发布的 HTTP 拒绝见 D146。模型与人工偏好实验沿用课程练习，个人标注由学员另录。

[干净录制](新版验收/D160-clean.json) · [故障录制](新版验收/D160-extra-event.json) · [接口记录](新版验收/D156-capture.txt)
