'use client'

import TaskBoardPanel from '@/components/panels/task-board-panel'

export default function TasksPage() {
  return (
    <div className="h-[calc(100vh-9rem)] min-h-[640px]">
      <TaskBoardPanel />
    </div>
  )
}
