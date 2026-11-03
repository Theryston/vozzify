'use client';

import type {
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
  SetStateAction,
} from 'react';
import { useState, useSyncExternalStore } from 'react';

import {
  activeRowIdFor,
  cancelEffects,
  comboboxKeyEvent,
  enabledEvent,
  type FieldEffect,
  isListOpen,
  keyEffects,
  pickSearchEffects,
  pickTrackEffects,
  runFieldEffects,
  suggestionRowId,
} from '../combobox-keys';
import type { ComboboxEvent } from '../combobox-state-machine';
import { createComboboxStore } from '../combobox-store';

type SuggestionsComboboxInput = {
  inputValue: string;
  setInputValue: (value: SetStateAction<string>) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** False on the search page, which has no list: only Enter and Escape act. */
  enabled: boolean;
  collapse: () => void;
};

/**
 * The header suggestions combobox: whether the list is open, which row the
 * keyboard highlights, and the field events that move them. The store and
 * the pure helpers in `combobox-keys` decide what happens; this hook keeps the
 * store in React and applies the DOM effects they describe.
 */
export function useSuggestionsCombobox({
  inputValue,
  setInputValue,
  inputRef,
  enabled,
  collapse,
}: SuggestionsComboboxInput) {
  const [store] = useState(createComboboxStore);
  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState,
  );

  const run = (effects: FieldEffect[]) =>
    runFieldEffects(effects, {
      // Opening a row clicks it, whatever its type: a Track link navigates,
      // and a row without a Track has its own press handler (see the rows).
      clickRow: (index) =>
        document.getElementById(suggestionRowId(index))?.click(),
      blur: () => inputRef.current?.blur(),
      collapse,
      setValue: setInputValue,
    });

  /** A pick or cancel closes the list (the state) and then leaves the field. */
  const leaveWith = (effects: FieldEffect[]) => {
    store.send({ type: 'blurred' });
    run(effects);
  };

  const sendIfEnabled = (event: ComboboxEvent) => {
    const gated = enabledEvent(enabled, event);
    if (gated) store.send(gated);
  };

  // The list never shows on the search page, even if a stale state is open, so
  // neither does its highlight: nothing may point at a row that is not there.
  const open = isListOpen(state, enabled);
  const highlighted = open ? state.highlighted : null;

  return {
    open,
    highlighted,
    activeRowId: activeRowIdFor(highlighted),
    send: store.send,
    onRowsChange: store.reportRows,
    onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => {
      const keyEvent = comboboxKeyEvent(
        event.key,
        inputValue,
        store.getState(),
      );
      if (!keyEvent) return;
      // Taken keys never move the caret or clear the field (Chrome clears a
      // search field on Escape), so the typed text survives every dismissal.
      event.preventDefault();
      run(keyEffects(store.send(keyEvent)));
    },
    onInputChange: (value: string) => {
      setInputValue(value);
      sendIfEnabled({ type: 'input-changed', query: value });
    },
    onFocus: () => sendIfEnabled({ type: 'focused', query: inputValue }),
    onBlur: () => {
      store.send({ type: 'blurred' });
      if (enabled) collapse();
    },
    /** Cancel on a small screen: close the list and collapse, never navigate. */
    onCancel: () => leaveWith(cancelEffects),
    /** A Track row: the next page must not reopen the old query. */
    onPickTrack: () => leaveWith(pickTrackEffects),
    /** The Search-for row: the field shows the query the search will use. */
    onPickSearch: () => leaveWith(pickSearchEffects(inputValue)),
  };
}

export type SuggestionsCombobox = ReturnType<typeof useSuggestionsCombobox>;
