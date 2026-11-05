if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL;
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(error => {
      console.error("تعذر تفعيل دعم التثبيت", error);
    });
  });
}
