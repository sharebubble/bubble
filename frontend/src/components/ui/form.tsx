import React from 'react';
import {
  FormProvider,
  useFormContext,
  Controller,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
  type ControllerRenderProps,
  type ControllerFieldState,
} from 'react-hook-form';

// ── Form (FormProvider wrapper) ───────────────────────────────────────────────

interface FormProps<T extends FieldValues> extends React.FormHTMLAttributes<HTMLFormElement> {
  children: React.ReactNode;
  // react-hook-form return value spread as {...form}
  [key: string]: any;
}

// Accept the full RHF form object spread as props (like Shadcn does)
function Form<T extends FieldValues>({ children, ...props }: FormProps<T>) {
  // Extract RHF methods from props (they come from spreading ...form)
  const {
    register,
    unregister,
    formState,
    watch,
    handleSubmit,
    reset,
    resetField,
    setError,
    clearErrors,
    setValue,
    setFocus,
    getValues,
    getFieldState,
    trigger,
    control,
    // Remove HTML form attributes from the spread
    className,
    onSubmit,
    ...htmlProps
  } = props;

  const methods: UseFormReturn<T> = {
    register,
    unregister,
    formState,
    watch,
    handleSubmit,
    reset,
    resetField,
    setError,
    clearErrors,
    setValue,
    setFocus,
    getValues,
    getFieldState,
    trigger,
    control,
  } as unknown as UseFormReturn<T>;

  return (
    <FormProvider {...methods}>
      <form className={className} onSubmit={onSubmit} {...htmlProps}>
        {children}
      </form>
    </FormProvider>
  );
}
Form.displayName = 'Form';

// ── FormField ─────────────────────────────────────────────────────────────────

interface FormFieldProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  name: TName;
  control: UseFormReturn<TFieldValues>['control'];
  render: (props: {
    field: ControllerRenderProps<TFieldValues, TName>;
    fieldState: ControllerFieldState;
  }) => React.ReactElement;
  defaultValue?: TFieldValues[TName];
}

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ name, control, render, defaultValue }: FormFieldProps<TFieldValues, TName>) {
  return (
    <Controller
      name={name}
      control={control}
      defaultValue={defaultValue}
      render={({ field, fieldState }) => render({ field, fieldState })}
    />
  );
}
FormField.displayName = 'FormField';

// ── FormItem ──────────────────────────────────────────────────────────────────

const FormItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={`space-y-2 ${className ?? ''}`} {...props}>
      {children}
    </div>
  ),
);
FormItem.displayName = 'FormItem';

// ── FormLabel ─────────────────────────────────────────────────────────────────

const FormLabel = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, children, ...props }, ref) => (
    <label ref={ref} className={`text-sm font-medium leading-none ${className ?? ''}`} {...props}>
      {children}
    </label>
  ),
);
FormLabel.displayName = 'FormLabel';

// ── FormControl ───────────────────────────────────────────────────────────────

const FormControl = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ children, ...props }, ref) => (
    <div ref={ref} {...props}>
      {children}
    </div>
  ),
);
FormControl.displayName = 'FormControl';

// ── FormDescription ───────────────────────────────────────────────────────────

const FormDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => (
  <p ref={ref} className={`text-sm text-muted-foreground ${className ?? ''}`} {...props}>
    {children}
  </p>
));
FormDescription.displayName = 'FormDescription';

// ── FormMessage ───────────────────────────────────────────────────────────────
// Shows validation errors via useFormContext

const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => {
  // Try to get the field error from context (best-effort)
  let errorMessage: React.ReactNode = children;

  // FormMessage is typically rendered inside a FormField render prop, so it
  // doesn't have automatic access to the field state here. Callers should
  // pass the error message as children when needed.
  if (!errorMessage) return null;

  return (
    <p ref={ref} className={`text-sm font-medium text-destructive ${className ?? ''}`} {...props}>
      {errorMessage}
    </p>
  );
});
FormMessage.displayName = 'FormMessage';

// ── useFormField (compatibility shim) ─────────────────────────────────────────

function useFormField() {
  return {
    id: '',
    name: '',
    formItemId: '',
    formDescriptionId: '',
    formMessageId: '',
    error: undefined,
    invalid: false,
    isDirty: false,
    isTouched: false,
    isValidating: false,
  };
}

export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
};
