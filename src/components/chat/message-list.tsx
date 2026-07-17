import { ProductCard } from "./product-card";
import type { PersistedMessage } from "./types";

type MessageListProperties = {
  messages: PersistedMessage[];
};

export function MessageList({ messages }: MessageListProperties) {
  if (messages.length === 0) {
    return (
      <section aria-label="Conversation" className="empty-conversation">
        <h1>How can I help you shop?</h1>
        <p>Tell me what you need, your budget, or a product category.</p>
      </section>
    );
  }

  return (
    <ol aria-label="Conversation" className="message-list">
      {messages.map((message) => (
        <li className={`message message--${message.role}`} key={message.id}>
          <article>
            <p className="message__role">
              {message.role === "assistant" ? "Shopping assistant" : "You"}
            </p>
            {message.status === "pending" ? (
              <p>Finding products for you…</p>
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
