import { useEffect } from "react";
import { Icon } from "./components/Icon";
import { NarratorBar } from "./components/NarratorBar";
import { ReaderSettings } from "./components/ReaderSettings";
import { narrator } from "./lib/narrator";
import { href, useRoute } from "./lib/router";
import { GuideView } from "./views/GuideView";
import { Library } from "./views/Library";
import { NewGuide } from "./views/NewGuide";

export function App() {
  const route = useRoute();
  // Leaving a guide stops the narrator so audio never plays over another page.
  const guideId = route.name === "guide" ? route.id : null;
  useEffect(() => () => narrator.stop(), [guideId]);

  useEffect(() => {
    if (route.name !== "guide" || !route.anchor) window.scrollTo(0, 0);
  }, [route.name, guideId, route.name === "guide" ? route.tab : null]);

  return (
    <>
      <header className="masthead">
        <div className="masthead-inner">
          <a className="wordmark" href={href({ name: "library" })}>
            <span className="wordmark-rule" aria-hidden />
            Margin
          </a>
          <nav className="masthead-actions">
            {route.name !== "new" && (
              <a className="btn btn-quiet" href={href({ name: "new" })}>
                <Icon name="plus" size={16} />
                <span>New guide</span>
              </a>
            )}
            <ReaderSettings />
          </nav>
        </div>
      </header>
      <main>
        {route.name === "library" && <Library />}
        {route.name === "new" && <NewGuide />}
        {route.name === "guide" && <GuideView id={route.id} tab={route.tab} anchor={route.anchor} />}
      </main>
      {route.name === "guide" && <NarratorBar visible={route.tab === "guide" || route.tab === "terms"} />}
    </>
  );
}
