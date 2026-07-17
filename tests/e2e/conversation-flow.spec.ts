import { expect, test } from "./fixtures";

test("persists product cards and resumes a prior conversation from the sidebar", async ({
  page,
}) => {
  const externalImageRequests: string[] = [];

  page.on("request", (request) => {
    if (request.resourceType() === "image" && /^https?:/u.test(request.url())) {
      externalImageRequests.push(request.url());
    }
  });

  await page.goto("/");
  await page.getByLabel("Message").fill("show phones under $400");
  const sendButton = page.getByRole("button", { name: "Send" });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  const firstProductCard = page.locator(".product-card").first();
  const firstProductImage = firstProductCard.locator("img");
  await expect(firstProductCard).toBeVisible();
  await expect(firstProductImage).toHaveAttribute(
    "src",
    /^data:image\/svg\+xml,/u,
  );
  await expect
    .poll(async () =>
      firstProductImage.evaluate((element) => {
        const image = element as HTMLImageElement;

        return image.complete && image.naturalWidth > 0;
      }),
    )
    .toBe(true);

  const savedTitle = await firstProductCard.getByRole("heading").textContent();
  const savedPrice = await firstProductCard
    .locator(".product-card__price")
    .textContent();

  expect(savedTitle).not.toBeNull();
  expect(savedPrice).toMatch(/^\$\d+\.\d{2}$/);

  await page.waitForURL(/\/conversations\//u);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: savedTitle ?? "" }),
  ).toBeVisible();
  await expect(page.getByText(savedPrice ?? "", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New conversation" }).click();
  await page.waitForURL("/");
  await expect(
    page.getByRole("heading", { name: "New conversation" }),
  ).toBeVisible();

  await page
    .getByRole("navigation", { name: "Recent conversations" })
    .getByRole("link", { name: "show phones under $400" })
    .click();

  await expect(
    page.getByRole("heading", { name: savedTitle ?? "" }),
  ).toBeVisible();
  await expect(page.getByText(savedPrice ?? "", { exact: true })).toBeVisible();
  expect(externalImageRequests).toEqual([]);
});
