import { expect, test } from "./fixtures";

test("shows new, non-overlapping cards when the user asks for more", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Message").fill("show phones");
  const sendButton = page.getByRole("button", { name: "Send" });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  const productCards = page.locator(".product-card");
  await expect(productCards).toHaveCount(6);

  const firstPageTitles = await productCards
    .getByRole("heading")
    .allTextContents();

  await page.getByLabel("Message").fill("show me more");
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  const assistantMessages = page.locator(".message-list__item--assistant");
  await expect(assistantMessages).toHaveCount(2);

  const continuationCards = assistantMessages.nth(1).locator(".product-card");
  await expect(continuationCards.first()).toBeVisible();

  const secondPageTitles = await continuationCards
    .getByRole("heading")
    .allTextContents();

  expect(secondPageTitles.length).toBeGreaterThan(0);
  for (const title of secondPageTitles) {
    expect(firstPageTitles).not.toContain(title);
  }
});
