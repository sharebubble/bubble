import { useLanguage } from '@/contexts/LanguageContext';
import { Button, Text, Title } from '@mantine/core';
import { SearchX } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

const JOKE_COUNT = 6;

export const ItemNotFound = () => {
  const { t } = useLanguage();
  // Picked once per mount so the message doesn't change on re-render.
  const [jokeIndex] = useState(() => Math.floor(Math.random() * JOKE_COUNT) + 1);

  return (
    <div className="container mx-auto px-4 py-16 flex flex-col items-center text-center gap-3">
      <SearchX size={64} className="text-[var(--mantine-color-dimmed)]" />
      <Title order={1}>404</Title>
      <Title order={2}>{t('itemDetail.notFoundTitle')}</Title>
      <Text c="dimmed" maw={480}>
        {t(`itemDetail.notFoundJoke${jokeIndex}`)}
      </Text>
      <Button component={Link} to="/" mt="md" variant="light">
        {t('itemDetail.notFoundBack')}
      </Button>
    </div>
  );
};
