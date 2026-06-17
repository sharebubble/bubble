import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import type { Image } from '@/services/django';
import { Carousel } from '@mantine/carousel';
import { ActionIcon } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { EmblaCarouselType } from 'embla-carousel';
import { ChevronLeft, ChevronRight, Expand, X } from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useState } from 'react';

interface ItemImageCarouselProps {
  images: Image[];
  /** Used to build descriptive alt text for each image. */
  itemName?: string;
}

const EMBLA_OPTIONS = { loop: true, align: 'center', containScroll: 'trimSnaps' } as const;

const imageSrc = (image: Image) => image.preview || image.original;

/**
 * Image gallery for the item detail page.
 *
 * Renders an inline carousel with hover controls, an image counter and dot
 * indicators, plus a full-screen lightbox. Arrow keys navigate the active
 * carousel and Escape closes the lightbox.
 */
export const ItemImageCarousel = ({ images, itemName }: ItemImageCarouselProps) => {
  const { t } = useLanguage();

  const [activeIndex, setActiveIndex] = useState(0);
  const [fullscreenOpened, fullscreen] = useDisclosure(false);
  const [inlineApi, setInlineApi] = useState<EmblaCarouselType | null>(null);
  const [fullscreenApi, setFullscreenApi] = useState<EmblaCarouselType | null>(null);

  const hasMultiple = images.length > 1;

  const scrollPrev = useCallback((api: EmblaCarouselType | null) => api?.scrollPrev(), []);
  const scrollNext = useCallback((api: EmblaCarouselType | null) => api?.scrollNext(), []);

  const openFullscreen = (index: number) => {
    setActiveIndex(index);
    fullscreen.open();
  };

  // Keep the lightbox carousel aligned with the active slide when it opens.
  useEffect(() => {
    if (fullscreenOpened) fullscreenApi?.scrollTo(activeIndex, true);
  }, [fullscreenOpened, fullscreenApi, activeIndex]);

  // Mirror the lightbox position back onto the inline carousel once closed.
  useEffect(() => {
    if (!fullscreenOpened) inlineApi?.scrollTo(activeIndex, true);
  }, [fullscreenOpened, inlineApi, activeIndex]);

  // The lightbox is modal, so a global listener is appropriate while it is open.
  // Arrow keys page through the images and Escape closes the viewer.
  useEffect(() => {
    if (!fullscreenOpened) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fullscreen.close();
      else if (e.key === 'ArrowLeft') scrollPrev(fullscreenApi);
      else if (e.key === 'ArrowRight') scrollNext(fullscreenApi);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreenOpened, fullscreenApi, fullscreen, scrollPrev, scrollNext]);

  // Inline arrow-key navigation is scoped to the gallery: it only fires while
  // the gallery itself is focused, so it never hijacks other page interactions.
  const handleInlineKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!hasMultiple) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      scrollPrev(inlineApi);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      scrollNext(inlineApi);
    }
  };

  if (images.length === 0) return null;

  const counter = hasMultiple ? `${activeIndex + 1} / ${images.length}` : null;

  return (
    <>
      {/* Inline gallery */}
      <div
        className="group relative self-start h-64 overflow-hidden rounded-xl bg-[var(--mantine-color-default-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mantine-primary-color-filled)] sm:h-72 md:h-80 lg:h-96"
        role="group"
        aria-roledescription="carousel"
        aria-label={itemName}
        tabIndex={hasMultiple ? 0 : -1}
        onKeyDown={handleInlineKeyDown}
      >
        <Carousel
          emblaOptions={EMBLA_OPTIONS}
          withControls={false}
          getEmblaApi={setInlineApi}
          onSlideChange={setActiveIndex}
          className="h-full w-full"
          styles={{ viewport: { height: '100%' }, container: { height: '100%' } }}
        >
          {images.map((image, index) => (
            <Carousel.Slide key={image.id ?? index}>
              <button
                type="button"
                onClick={() => openFullscreen(index)}
                aria-label={t('itemDetail.openImage')}
                className="relative block h-full w-full cursor-zoom-in"
              >
                <img
                  src={imageSrc(image)}
                  alt={`${itemName} — ${index + 1}`}
                  className="absolute inset-0 h-full w-full object-cover"
                  loading={index === 0 ? 'eager' : 'lazy'}
                />
              </button>
            </Carousel.Slide>
          ))}
        </Carousel>

        {/* Counter badge */}
        {counter && (
          <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/60 shadow-md px-2.5 py-1 text-xs font-medium text-white">
            {counter}
          </div>
        )}

        {/* Expand hint */}
        <ActionIcon
          variant="filled"
          color="dark"
          radius="xl"
          size="lg"
          aria-label={t('itemDetail.openImage')}
          onClick={() => openFullscreen(activeIndex)}
          className="absolute bottom-3 right-3 bg-black/60 shadow-md opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
        >
          <Expand size={18} />
        </ActionIcon>

        {/* Edge navigation arrows (revealed on hover / always on touch) */}
        {hasMultiple && (
          <>
            <ActionIcon
              variant="filled"
              color="dark"
              radius="xl"
              size="lg"
              aria-label={t('itemDetail.previousImage')}
              onClick={() => scrollPrev(inlineApi)}
              className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/60 shadow-md opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
            >
              <ChevronLeft size={20} />
            </ActionIcon>
            <ActionIcon
              variant="filled"
              color="dark"
              radius="xl"
              size="lg"
              aria-label={t('itemDetail.nextImage')}
              onClick={() => scrollNext(inlineApi)}
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/60 shadow-md opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
            >
              <ChevronRight size={20} />
            </ActionIcon>
          </>
        )}

        {/* Dot indicators */}
        {hasMultiple && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
            {images.map((image, idx) => (
              <button
                key={image.id ?? idx}
                type="button"
                aria-label={`${t('itemDetail.goToImage')} ${idx + 1}`}
                aria-current={activeIndex === idx}
                onClick={() => inlineApi?.scrollTo(idx)}
                className={cn(
                  'h-2 rounded-full transition-all',
                  activeIndex === idx ? 'w-5 bg-white' : 'w-2 bg-white/50 hover:bg-white/80',
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* Full-screen lightbox */}
      {fullscreenOpened && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          role="dialog"
          aria-modal="true"
          onClick={fullscreen.close}
        >
          <div className="relative h-full w-full" onClick={e => e.stopPropagation()}>
            <Carousel
              emblaOptions={EMBLA_OPTIONS}
              withControls={false}
              getEmblaApi={setFullscreenApi}
              onSlideChange={setActiveIndex}
              initialSlide={activeIndex}
              className="h-full w-full"
              styles={{ viewport: { height: '100%' }, container: { height: '100%' } }}
            >
              {images.map((image, index) => (
                <Carousel.Slide
                  key={image.id ?? index}
                  className="flex items-center justify-center"
                >
                  <img
                    src={image.original || imageSrc(image)}
                    alt={`${itemName} — ${index + 1}`}
                    onClick={fullscreen.close}
                    className="max-h-[90vh] max-w-[92vw] cursor-zoom-out object-contain"
                  />
                </Carousel.Slide>
              ))}
            </Carousel>

            {counter && (
              <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-white/15 px-3 py-1 text-sm font-medium text-white backdrop-blur">
                {counter}
              </div>
            )}

            {hasMultiple && (
              <>
                <ActionIcon
                  variant="filled"
                  color="dark"
                  radius="xl"
                  size="xl"
                  aria-label={t('itemDetail.previousImage')}
                  onClick={() => scrollPrev(fullscreenApi)}
                  className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/15"
                >
                  <ChevronLeft size={28} />
                </ActionIcon>
                <ActionIcon
                  variant="filled"
                  color="dark"
                  radius="xl"
                  size="xl"
                  aria-label={t('itemDetail.nextImage')}
                  onClick={() => scrollNext(fullscreenApi)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/15"
                >
                  <ChevronRight size={28} />
                </ActionIcon>
              </>
            )}

            <ActionIcon
              variant="filled"
              color="dark"
              radius="xl"
              size="lg"
              aria-label={t('itemDetail.closeViewer')}
              onClick={fullscreen.close}
              className="absolute right-4 top-4 bg-white/15"
            >
              <X size={22} />
            </ActionIcon>
          </div>
        </div>
      )}
    </>
  );
};

export default ItemImageCarousel;
