"use client";

import * as React from "react";

/**
 * A dropdown that keeps showing what was chosen after its form is submitted.
 *
 * React puts a form's fields back to their defaults once its action has run.
 * A `<select>` comes out of that showing its first option rather than what
 * was just saved — and holding the value in state is not enough on its own,
 * because React sees the same value as before and leaves the element as the
 * reset left it. So the choice is held here and put back after every reset.
 * When the server comes back with a different saved value, that is followed.
 *
 * Used exactly like `<select>`. One that is given `value`, or no default at
 * all, is passed through untouched.
 */
export function Select({
  defaultValue,
  value,
  onChange,
  ...props
}: React.ComponentProps<"select">) {
  const initial = defaultValue === undefined ? undefined : String(defaultValue);
  const [chosen, setChosen] = React.useState(initial);
  const [saved, setSaved] = React.useState(initial);
  const element = React.useRef<HTMLSelectElement>(null);
  const latest = React.useRef(chosen);

  if (saved !== initial) {
    setSaved(initial);
    setChosen(initial);
  }

  const held = value === undefined && initial !== undefined;

  React.useEffect(() => {
    latest.current = chosen;
    // Whatever the element was left showing, it shows the choice.
    if (held && element.current && chosen !== undefined) element.current.value = chosen;
  });

  React.useEffect(() => {
    const form = element.current?.form;
    if (!held || !form) return;

    const restore = () => {
      // The event comes before the reset itself, so wait for it to happen.
      setTimeout(() => {
        if (element.current && latest.current !== undefined) {
          element.current.value = latest.current;
        }
      }, 0);
    };

    form.addEventListener("reset", restore);
    return () => form.removeEventListener("reset", restore);
  }, [held]);

  if (!held) return <select {...props} value={value} defaultValue={defaultValue} onChange={onChange} />;

  return (
    <select
      {...props}
      ref={element}
      value={chosen}
      onChange={(event) => {
        setChosen(event.target.value);
        onChange?.(event);
      }}
    />
  );
}
