'use client';

import { useState } from 'react';
import { X, ChevronLeft, ChevronRight, Calendar, Activity, ListTodo } from 'lucide-react';
import type { GatewayClient, GatewayStatus } from '@/lib/gateway/GatewayClient';
import { CronTab } from './FlowsSidebar/CronTab';
import { SessionsTab } from './FlowsSidebar/SessionsTab';
import { TodosTab } from './FlowsSidebar/TodosTab';

type Tab = 'cron' | 'sessions' | 'todos';

type FlowsSidebarProps = {
  client: GatewayClient;
  gwStatus: GatewayStatus;
  isOpen: boolean;
  onToggle: () => void;
};

export const FlowsSidebar = ({ client, gwStatus, isOpen, onToggle }: FlowsSidebarProps) => {
  const [activeTab, setActiveTab] = useState<Tab>('cron');

  if (!isOpen) {
    return (
      <button
        type="button"
        className="fixed top-20 right-0 z-[170] bg-primary text-primary-foreground px-2 py-8 rounded-l-lg shadow-lg hover:opacity-90 transition-opacity"
        onClick={onToggle}
        title="Open Flows Panel"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
    );
  }

  return (
    <div className="fixed top-14 right-0 bottom-0 w-[480px] bg-background border-l border-border z-[170] flex flex-col shadow-xl">
      {/* Header with tabs */}
      <div className="flex-shrink-0 border-b border-border">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold">Flows & Automation</h2>
          <button
            type="button"
            className="ui-btn-icon h-7 w-7 !bg-transparent hover:!bg-muted"
            onClick={onToggle}
            title="Close Panel"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            type="button"
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 ${
              activeTab === 'cron'
                ? 'border-primary text-primary bg-primary/5'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
            onClick={() => setActiveTab('cron')}
          >
            <Calendar className="w-3.5 h-3.5" />
            Cron Jobs
          </button>
          <button
            type="button"
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 ${
              activeTab === 'sessions'
                ? 'border-primary text-primary bg-primary/5'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
            onClick={() => setActiveTab('sessions')}
          >
            <Activity className="w-3.5 h-3.5" />
            Sessions
          </button>
          <button
            type="button"
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 ${
              activeTab === 'todos'
                ? 'border-primary text-primary bg-primary/5'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
            onClick={() => setActiveTab('todos')}
          >
            <ListTodo className="w-3.5 h-3.5" />
            Captures
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'cron' && <CronTab client={client} gwStatus={gwStatus} />}
        {activeTab === 'sessions' && <SessionsTab isActive={activeTab === 'sessions'} />}
        {activeTab === 'todos' && <TodosTab />}
      </div>
    </div>
  );
};
