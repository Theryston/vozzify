'use client';

import {
  SEARCH_MAX_QUERY_LENGTH,
  type SearchResultItem,
} from '@vozzify/contracts';
import { SearchIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useRecordingPickerSearch } from '../hooks/use-private-track-metadata';

type RecordingChoice = { mbid: string; title: string; artist: string };
type PickerProps = {
  selected: RecordingChoice | null;
  pending: boolean;
  select: (recording: RecordingChoice | null) => void;
};

export function PrivateTrackRecordingPicker({
  selected,
  pending,
  select,
}: PickerProps) {
  const [query, setQuery] = useState('');
  const search = useRecordingPickerSearch(query);
  const submit = (nextQuery: string) => {
    if (nextQuery && nextQuery === query) {
      void search.refetch();
      return;
    }
    setQuery(nextQuery);
  };
  return (
    <div className="flex flex-col gap-3">
      <SelectedRecording
        selected={selected}
        pending={pending}
        select={select}
      />
      <RecordingSearchField pending={pending} onSearch={submit} />
      {query ? (
        <RecordingResults
          search={search}
          pending={pending}
          onChoose={(result) => {
            select({
              mbid: result.mbid,
              title: result.title,
              artist: result.artistCredit,
            });
            setQuery('');
          }}
        />
      ) : null}
    </div>
  );
}

function SelectedRecording({ selected, pending, select }: PickerProps) {
  const t = useTranslations('privateTracks.metadata');
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <p className="min-w-0 flex-1 break-words text-muted-foreground">
        {selected
          ? t('linkedRecording', {
              title: selected.title,
              artist: selected.artist,
            })
          : t('noRecording')}
      </p>
      {selected ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => select(null)}
        >
          {t('unlink')}
        </Button>
      ) : null}
    </div>
  );
}

type SearchFieldProps = { pending: boolean; onSearch: (query: string) => void };
function RecordingSearchField({ pending, onSearch }: SearchFieldProps) {
  const t = useTranslations('privateTracks.metadata');
  const searchId = useId();
  const [input, setInput] = useState('');
  const submit = () => onSearch(input.trim());
  return (
    <Field>
      <FieldLabel htmlFor={searchId}>{t('searchLabel')}</FieldLabel>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          id={searchId}
          type="search"
          value={input}
          maxLength={SEARCH_MAX_QUERY_LENGTH}
          onChange={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          disabled={pending}
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label={t('search')}
          onClick={submit}
          disabled={pending || input.trim().length === 0}
        >
          <SearchIcon aria-hidden="true" />
        </Button>
      </div>
    </Field>
  );
}

function RecordingResults({
  search,
  pending,
  onChoose,
}: {
  search: ReturnType<typeof useRecordingPickerSearch>;
  pending: boolean;
  onChoose: (result: SearchResultItem) => void;
}) {
  const t = useTranslations('privateTracks.metadata');
  if (search.isPending) return <p role="status">{t('searching')}</p>;
  if (search.isError) return <p role="alert">{t('searchError')}</p>;
  if (!search.data.results.length) return <p role="status">{t('noResults')}</p>;
  return (
    <ul
      aria-label={t('searchResults')}
      className="max-h-44 overflow-y-auto rounded-xl border"
    >
      {search.data.results.map((result) => (
        <li key={result.mbid}>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            className="h-auto min-h-12 w-full justify-start whitespace-normal rounded-md px-3 py-2 text-left"
            onClick={() => onChoose(result)}
          >
            <span className="min-w-0 break-words">
              <span className="block">{result.title}</span>
              <span className="block text-muted-foreground text-xs">
                {result.artistCredit}
              </span>
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
