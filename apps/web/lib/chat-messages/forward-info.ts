export type ForwardInfo = {
  attempted: boolean
  delivered: boolean
  reason?: string
  session?: string
  runId?: string
  /** 服务端已完成本轮同步等待（agent.wait 等），客户端不应再进入「等待回复」竞态 */
  completed?: boolean
  /** agent.wait 成功结束但未解析到可展示正文且 history 也无；不写会话内占位句，由客户端 toast */
  emptyAssistantOutput?: boolean
}
