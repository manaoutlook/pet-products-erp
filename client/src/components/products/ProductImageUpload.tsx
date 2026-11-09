import { useRef, useState, type ChangeEvent } from "react";
import { ImagePlus, Loader2, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  MAX_PRODUCT_GALLERY_IMAGES,
  ProductImageUploadError,
  uploadProductImage,
} from "@/utils/product-image-upload";

interface ProductImageUploadProps {
  /** Featured picture URL - the one shown in the product grid. */
  featuredImage: string | null;
  /** Extra picture URLs (max MAX_PRODUCT_GALLERY_IMAGES). */
  galleryImages: string[];
  onFeaturedChange: (url: string | null) => void;
  onGalleryChange: (urls: string[]) => void;
  disabled?: boolean;
}

const THUMBNAIL_CLASS = "h-24 w-24 rounded-md border bg-muted object-cover";

/**
 * Picture picker for the product form.
 *
 * One *featured* picture (shown in the product list grid) plus up to ten extra
 * gallery pictures that are only stored for the product. Each picked file is
 * compressed and uploaded immediately (see utils/product-image-upload), so the
 * form only ever holds short URLs.
 */
export function ProductImageUpload({
  featuredImage,
  galleryImages,
  onFeaturedChange,
  onGalleryChange,
  disabled = false,
}: ProductImageUploadProps) {
  const { toast } = useToast();
  const featuredInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingFeatured, setIsUploadingFeatured] = useState(false);
  const [isUploadingGallery, setIsUploadingGallery] = useState(false);

  const isBusy = disabled || isUploadingFeatured || isUploadingGallery;
  const remainingSlots = Math.max(0, MAX_PRODUCT_GALLERY_IMAGES - galleryImages.length);

  const reportError = (error: unknown) => {
    toast({
      title: "Picture not uploaded",
      description:
        error instanceof ProductImageUploadError
          ? error.message
          : "The picture could not be uploaded.",
      variant: "destructive",
    });
  };

  const handleFeaturedFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    event.target.value = "";
    if (!file) return;

    setIsUploadingFeatured(true);
    try {
      const url = await uploadProductImage(file);
      onFeaturedChange(url);
    } catch (error) {
      reportError(error);
    } finally {
      setIsUploadingFeatured(false);
    }
  };

  const handleGalleryFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    if (remainingSlots === 0) {
      toast({
        title: "Gallery is full",
        description: `A product can keep ${MAX_PRODUCT_GALLERY_IMAGES} extra pictures. Remove one first.`,
        variant: "destructive",
      });
      return;
    }

    const selected = files.slice(0, remainingSlots);
    if (files.length > selected.length) {
      toast({
        title: "Only some pictures were added",
        description: `The gallery keeps ${MAX_PRODUCT_GALLERY_IMAGES} extra pictures, so ${
          files.length - selected.length
        } file(s) were skipped.`,
        variant: "destructive",
      });
    }

    setIsUploadingGallery(true);
    const uploaded: string[] = [];
    try {
      for (const file of selected) {
        uploaded.push(await uploadProductImage(file));
      }
    } catch (error) {
      reportError(error);
    } finally {
      // Keep whatever was uploaded before the failure - re-uploading only the
      // remaining pictures is cheaper than discarding them.
      if (uploaded.length > 0) {
        onGalleryChange([...galleryImages, ...uploaded]);
      }
      setIsUploadingGallery(false);
    }
  };

  // Promoting a gallery picture swaps it with the current featured picture so no
  // picture is lost.
  const handleMakeFeatured = (index: number) => {
    const candidate = galleryImages[index];
    if (!candidate) return;

    const nextGallery = [...galleryImages];
    if (featuredImage) {
      nextGallery[index] = featuredImage;
    } else {
      nextGallery.splice(index, 1);
    }

    onFeaturedChange(candidate);
    onGalleryChange(nextGallery);
  };

  const handleRemoveGalleryImage = (index: number) => {
    onGalleryChange(galleryImages.filter((_, position) => position !== index));
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium leading-none">Featured picture</label>
        <p className="mt-1 text-xs text-muted-foreground">
          Shown in the product list grid and at the top of the product details.
        </p>

        <div className="mt-2 flex items-center gap-3">
          {featuredImage ? (
            <img
              src={featuredImage}
              alt="Featured product picture"
              className={THUMBNAIL_CLASS}
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-md border border-dashed bg-muted/40 text-muted-foreground">
              <ImagePlus className="h-6 w-6" />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <input
              ref={featuredInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label="Upload featured picture"
              onChange={handleFeaturedFile}
              disabled={isBusy}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => featuredInputRef.current?.click()}
            >
              {isUploadingFeatured ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="mr-2 h-4 w-4" />
              )}
              {featuredImage ? "Replace" : "Upload"}
            </Button>
            {featuredImage && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isBusy}
                onClick={() => onFeaturedChange(null)}
              >
                <X className="mr-2 h-4 w-4" />
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium leading-none">Additional pictures</label>
          <span className="text-xs text-muted-foreground">
            {galleryImages.length}/{MAX_PRODUCT_GALLERY_IMAGES}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Up to {MAX_PRODUCT_GALLERY_IMAGES} extra pictures, stored with the product and shown on
          its details.
        </p>

        <div className="mt-2 flex flex-wrap gap-2">
          {galleryImages.map((url, index) => (
            <div key={`${url}-${index}`} className="group relative">
              <img
                src={url}
                alt={`Additional product picture ${index + 1}`}
                className={THUMBNAIL_CLASS}
              />
              <div className="absolute right-1 top-1 flex gap-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="h-6 w-6"
                  title="Use as featured picture"
                  aria-label={`Use picture ${index + 1} as featured`}
                  disabled={isBusy}
                  onClick={() => handleMakeFeatured(index)}
                >
                  <Star className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="h-6 w-6"
                  title="Remove picture"
                  aria-label={`Remove picture ${index + 1}`}
                  disabled={isBusy}
                  onClick={() => handleRemoveGalleryImage(index)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}

          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            aria-label="Upload additional pictures"
            onChange={handleGalleryFiles}
            disabled={isBusy || remainingSlots === 0}
          />
          <Button
            type="button"
            variant="outline"
            className="h-24 w-24 flex-col gap-1 border-dashed"
            disabled={isBusy || remainingSlots === 0}
            onClick={() => galleryInputRef.current?.click()}
          >
            {isUploadingGallery ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ImagePlus className="h-5 w-5" />
            )}
            <span className="text-xs">Add</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ProductImageUpload;
