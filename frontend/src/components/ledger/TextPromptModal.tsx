import { useLanguage } from '@/contexts/LanguageContext';
import { Alert, Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core';
import { useState } from 'react';

interface TextPromptModalProps {
  opened: boolean;
  onClose: () => void;
  title: string;
  body?: string;
  label: string;
  placeholder?: string;
  confirm: string;
  color?: string;
  /** Allow sending without text (e.g. an optional note). */
  optional?: boolean;
  loading?: boolean;
  onSubmit: (text: string) => Promise<unknown>;
  /** Turns a rejected request into a message for the user. */
  errorMessage: (error: unknown) => string;
}

/** A small dialog that asks for a reason, answer or note and sends it. */
export const TextPromptModal = ({ opened, onClose, title, ...props }: TextPromptModalProps) => (
  <Modal opened={opened} onClose={onClose} title={title}>
    {/* Unmounted when closed, so each opening starts empty. */}
    <TextPromptForm onClose={onClose} {...props} />
  </Modal>
);

const TextPromptForm = ({
  onClose,
  body,
  label,
  placeholder,
  confirm,
  color,
  optional = false,
  loading = false,
  onSubmit,
  errorMessage,
}: Omit<TextPromptModalProps, 'opened' | 'title'>) => {
  const { t } = useLanguage();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await onSubmit(text.trim());
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Stack gap="sm">
      {body && <Text size="sm">{body}</Text>}
      <Textarea
        label={label}
        placeholder={placeholder}
        value={text}
        onChange={event => setText(event.currentTarget.value)}
        maxLength={2000}
        autosize
        minRows={2}
        required={!optional}
        data-autofocus
      />
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          color={color}
          onClick={() => void submit()}
          loading={loading}
          disabled={!optional && !text.trim()}
        >
          {confirm}
        </Button>
      </Group>
    </Stack>
  );
};
