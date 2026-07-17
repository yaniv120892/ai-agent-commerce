"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { ConversationSummary } from "./types";

export const CONVERSATION_SIDEBAR_ID = "conversation-sidebar";

type ConversationSidebarProperties = {
  activeConversationId: string | null;
  isOpen: boolean;
  onConversationNavigate: () => void;
  onNewConversation: () => void;
};

function isConversationSummary(value: unknown): value is ConversationSummary {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "title" in value &&
    typeof value.title === "string" &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    "updatedAt" in value &&
    typeof value.updatedAt === "string"
  );
}

export function ConversationSidebar({
  activeConversationId,
  isOpen,
  onConversationNavigate,
  onNewConversation,
}: ConversationSidebarProperties) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const sidebarRef = useRef<HTMLElement | null>(null);

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
          setConversations(summaries.filter(isConversationSummary));
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

  useEffect(() => {
    if (isOpen) {
      sidebarRef.current?.focus();
    }
  }, [isOpen]);

  return (
    <aside
      className={`conversation-sidebar${isOpen ? " conversation-sidebar--open" : ""}`}
      id={CONVERSATION_SIDEBAR_ID}
      ref={sidebarRef}
      tabIndex={-1}
    >
      <button
        className="new-conversation-button"
        onClick={onNewConversation}
        type="button"
      >
        <span aria-hidden="true" className="new-conversation-button__icon">
          +
        </span>
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
                className="conversation-sidebar__link"
                href={`/conversations/${conversation.id}`}
                onClick={onConversationNavigate}
                title={conversation.title}
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
