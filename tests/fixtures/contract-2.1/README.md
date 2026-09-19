# 契约2.1完整响应样例

入口是 [full-index.json](full-index.json)，共19份完整HTTP响应或Socket快照；每项注明endpoint、schema与场景。JSON来自contract-openapi测试实际调用，使用隔离测试账号和假时钟。角色/成员ID相互对应，不能把这些测试ID发给真实服务。

前端可先使用lobby-formal、lobby-observer、night-door、night-spirit、started-public-observer、private-second-screen、day-election和post-review-lobby，覆盖主要布局及权限分支。目录、当前账号、聊天完整回执和复盘也有完整JSON。review-constructed的胜负由测试构造，只用于格式演示；真实玩法链的验收另见进度记录。

bootstrap来自关闭头像/语音注入的隔离HTTP测试环境，演示features=false分支；真实部署以在线/bootstrap为准，不能将fixture开关写死。时间单位为Unix毫秒，假时钟从1000开始；倒计时按serverTime与本地单调时间估算。

[manual-fragments-index.json](manual-fragments-index.json)另列8个人工小样例，帮助查看pending、错误和control等结构；它们不能代替完整RoomSnapshot。

生成时在Docker设置EXPORT_CONTRACT_FIXTURES到额外读写挂载的临时目录，并运行tests/contract-openapi.test.ts。确认全部测试通过后再更新本目录；默认测试不写源码。所有样例都会经Ajv2020校验，禁止加入密码、密码hash、Cookie或邀请/语音token。
