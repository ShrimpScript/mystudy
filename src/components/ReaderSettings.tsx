import { usePrefs, type TextSize, type Theme } from "../lib/prefs";
import { IS_ARTIFACT } from "../lib/runtime";
import { Popover, Segmented } from "./Popover";

export function ReaderSettings() {
  const [prefs, setPrefs] = usePrefs();
  return (
    <Popover label="Reading settings" button={<span className="aa">Aa</span>}>
      {!IS_ARTIFACT && (
        <>
          <div className="field-label">Theme</div>
          <Segmented<Theme>
            name="Theme"
            value={prefs.theme}
            onChange={(theme) => setPrefs({ theme })}
            options={[
              { value: "system", label: "Auto" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </>
      )}
      <div className="field-label">Text size</div>
      <Segmented<TextSize>
        name="Text size"
        value={prefs.size}
        onChange={(size) => setPrefs({ size })}
        options={[
          { value: "s", label: "Small" },
          { value: "m", label: "Medium" },
          { value: "l", label: "Large" },
        ]}
      />
    </Popover>
  );
}
