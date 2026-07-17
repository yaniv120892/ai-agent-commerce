import { expect, test } from "./fixtures";

const conversationsToggle = { name: "Conversations" };

test("opens the chat directly instead of the conversation list", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByLabel("Message")).toBeInViewport();
  await expect(page.locator(".conversation-sidebar")).toBeHidden();
});

test("opens and closes the conversation drawer", async ({ page }) => {
  await page.goto("/");

  const toggle = page.getByRole("button", conversationsToggle);
  const sidebar = page.locator(".conversation-sidebar");

  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await toggle.click();
  await expect(sidebar).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("Escape");
  await expect(sidebar).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await expect(sidebar).toBeVisible();
  await page.getByRole("button", { name: "Close conversation list" }).click();
  await expect(sidebar).toBeHidden();
});

test("renders product cards without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Message").fill("show phones under $400");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.locator(".product-card").first()).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(() => {
    return (
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
    );
  });

  expect(hasHorizontalOverflow).toBe(false);
});
