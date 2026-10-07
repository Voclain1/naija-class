import { router } from "expo-router";
import { useEffect } from "react";

// schoolkit://payments/callback — where checkout hands back to the app
// (lib/payments/checkout.ts). On iOS the auth session consumes that address
// and this screen never shows. On Android the same address is also delivered
// to the router as a deep link, so without this route the parent would see a
// "page not found" screen over their invoice. It renders nothing and steps
// back to wherever checkout started; runCheckout is already asking the API
// what happened. Nothing here reads the URL: the outcome never comes from it.
export default function PaymentReturn() {
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, []);
  return null;
}
