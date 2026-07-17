"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { ConversationSummary } from "./types";

type ConversationSidebarProperties = {
  activeConversationId: string | null;
  onConversationNavigate: () => void;
  onNewConversation: () => void;
};

export function ConversationSidebar({
  activeConversationId,
  onConversationNavigate,
  onNewConversation,
}: ConversationSidebarProperties) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  useEffect(() => {
    let isMounted = true;

    async function loadConversations(): Promise<void> {
      try {
        const response = await fetch("/api/conversations?limit=20&offset=0");

        if (!response.ok) {
          return;
        }

        const summaries: unknown = await response.json();

        if (isMounted && Array.isArray(summaries)) {
          setConversations(summaries as ConversationSummary[]);
        }
      } catch {
        return;
      }
    }

    void loadConversations();

    return () => {
      isMounted = false;
    };
  }, [activeConversationId]);

  return (
    <aside className="conversation-sidebar">
      <button
        className="new-conversation-button"
        onClick={onNewConversation}
        type="button"
      >
        New conversation
      </button>
      <nav aria-label="Recent conversations">
        <h2>Recent conversations</h2>
        <ul>
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link
                aria-current={
                  conversation.id === activeConversationId ? "page" : undefined
                }
                href={`/conversations/${conversation.id}`}
                onClick={onConversationNavigate}
              >
                {conversation.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
