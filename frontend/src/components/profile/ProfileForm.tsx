import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { useProfile } from '@/hooks/useProfile';
import { useProfileFieldAutoSave } from '@/hooks/useProfileFieldAutoSave';
import { useAppConfig } from '@/hooks/useAppConfig';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@/hooks/useNotificationPreferences';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Loader2 } from 'lucide-react';
import React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { cn } from '@/lib/utils';

const profileSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export const ProfileForm = () => {
  const { data: profile, isLoading } = useProfile();
  const { fieldStates, saveField } = useProfileFieldAutoSave();
  const { data: notifPrefs, isLoading: notifLoading } = useNotificationPreferences();
  const updateNotifPrefs = useUpdateNotificationPreferences();
  const { rocketchatEnabled } = useAppConfig();
  const { t } = useLanguage();

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: '',
      phone: '',
    },
  });

  React.useEffect(() => {
    if (profile) {
      form.reset({
        name: profile.name ?? '',
        phone: profile.phone ?? '',
      });
    }
  }, [profile, form]);

  const getFieldBorderClass = (fieldName: string) => {
    const status = fieldStates[fieldName]?.status;
    if (status === 'success') return 'border-green-500 focus-visible:ring-green-500';
    if (status === 'error') return 'border-destructive focus-visible:ring-destructive';
    return '';
  };

  const FieldStatusIcon = ({ fieldName }: { fieldName: string }) => {
    const status = fieldStates[fieldName]?.status;
    if (status === 'saving')
      return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    if (status === 'success') return <Check className="h-4 w-4 text-green-500" />;
    return null;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex justify-center items-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('profile.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Read-only account fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div className="space-y-1">
              <p className="text-sm font-medium leading-none">{t('profile.username')}</p>
              <p className="text-sm text-muted-foreground border rounded-md px-3 py-2 bg-muted/40">
                {profile?.username ?? '—'}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium leading-none">{t('profile.email')}</p>
              <p className="text-sm text-muted-foreground border rounded-md px-3 py-2 bg-muted/40">
                {profile?.email ?? '—'}
              </p>
            </div>
          </div>

          <Form {...form}>
            <form className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('profile.name')}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          placeholder={t('profile.name')}
                          {...field}
                          className={cn('pr-8', getFieldBorderClass('name'))}
                          onBlur={() => saveField('name', field.value)}
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2">
                          <FieldStatusIcon fieldName="name" />
                        </div>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('profile.phone')}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          placeholder={t('profile.phone')}
                          {...field}
                          className={cn('pr-8', getFieldBorderClass('phone'))}
                          onBlur={() => saveField('phone', field.value)}
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2">
                          <FieldStatusIcon fieldName="phone" />
                        </div>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Notifications Card */}
      {rocketchatEnabled && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t('profile.notifications')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('profile.notificationsDesc')}</p>
          </CardHeader>
          <CardContent>
            {notifLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <Checkbox
                    checked={notifPrefs?.rocketchat_new_message ?? false}
                    disabled={updateNotifPrefs.isPending}
                    onCheckedChange={checked => {
                      updateNotifPrefs.mutate({ rocketchat_new_message: !!checked });
                    }}
                  />
                  <div className="space-y-1 leading-none">
                    <p className="text-sm font-medium leading-none">
                      {t('profile.rocketchatNewMessage')}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('profile.rocketchatNewMessageDesc')}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
};
