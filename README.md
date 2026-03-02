# rc作业

## 需求分析

* 实现一个webhook系统
* 配置化支持不同api
* 保证消息投递可靠

## 架构设计

* 消息使用mq consumer + task schedular处理
* 独立的死信队列保存失败超上限的消息

## 决策与取舍

* 投递语义明确为`至少一次`，要求提供方的api自己实现幂等（或者明确会有重复投递的风险）
* 失败达到上限投递到死信，死信的处理留白
* api配置写到json中，上生产需接入db
* 指数退避用`setTimeout`实现，上生产需接入redis实现延时处理


## agent指令
```md
基于node.js + ts构建一个webhook系统，核心功能如下：

1. **入口Api**：使用`express.js`，暴露一个`POST /notify`接口，接收 `{ eventId, payload }` ，追加记录`attempt: 0`并存入kafka的topic：`notification-tasks`
2. **消费者服务**： 监听该topic，根据eventId从配置仓库获取通知服务配置（包含api url、header/body格式定义、重试次数等），配置仓库用map mock一个即可
3. **核心逻辑**：基于配置中的`header/body格式定义`，使用`mustache.js`渲染`payload`，使用渲染的结果以POST形式请求配置中的`api url`
4. **指数退避**：对于失败的通知请求，利用追加的`attempt`字段实现指数退避，最大延迟10秒，延迟用`setTimeout`实现
5. **最终失败**：失败5次以后写入死信队列`notification-tasks-dead-letter`并不再处理

其他要求：

1. **日志**：集成并使用`pino`日志库，在`/notify`和调用通知api时分别记录`info`日志，在发起重试的error处理中记录`warn`日志，在写死信时用`error`记录完整的异常栈
2. **单测**：使用`vitest`编写单测，达到核心逻辑代码和分支覆盖率超过60%，用例通过率100%
```