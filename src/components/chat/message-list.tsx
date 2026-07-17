import { ProductCard } from "./product-card";
import type { PersistedMessage } from "./types";

type MessageListProperties = {
  messages: PersistedMessage[];
};

function messageAvatarLabel(role: PersistedMessage["role"]): string {
  return role === "assistant" ? "AI" : "You";
}

export function MessageList({ messages }: MessageListProperties) {
  if (messages.length === 0) {
    return (
      <section aria-label="Conversation" className="chat-empty-state">
        <p aria-hidden="true" className="chat-empty-state__icon">
          🛍️
        </p>
        <h2>How can I help you shop?</h2>
        <p>Tell me what you need, your budget, or a product category.</p>
      </section>
    );
  }

  return (
    <ol aria-label="Conversation" className="message-list">
      {messages.map((message) => (
        <li
          className={`message-list__item message-list__item--${message.role}`}
          key={message.id}
        >
          <span
            aria-hidden="true"
            className={`message-avatar message-avatar--${message.role}`}
          >
            {messageAvatarLabel(message.role)}
          </span>
          <article className={`message-bubble message-bubble--${message.role}`}>
            {message.status === "pending" ? (
              <p className="typing-indicator">
                Finding products for you
                <span aria-hidden="true" className="typing-indicator__dots">
                  <i />
                  <i />
                  <i />
                </span>
              </p>
            ) : (
              <p>{message.content}</p>
            )}
            {message.productCards.length > 0 ? (
              <div className="product-card-list">
                {message.productCards.map((product) => (
                  <ProductCard key={product.productId} product={product} />
                ))}
              </div>
            ) : null}
          </article>
        </li>
      ))}
    </ol>
  );
}
