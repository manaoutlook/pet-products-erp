import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { MOBILE_NUMBER_PATTERN, normalizePhoneNumber } from "@shared/phone";

const customerProfileSchema = z.object({
  mobileNumber: z.string()
    .min(1, "Mobile number is required")
    .regex(MOBILE_NUMBER_PATTERN, "Invalid mobile number format"),
  // Optional: a B2C walk-in has no company, so an empty box is sent as null.
  companyName: z.string().max(255, "Company name is too long").nullable().optional(),
  contactPerson: z.string().min(1, "Contact person is required"),
  email: z.string().email("Invalid email address"),
  address: z.string().min(1, "Address is required"),
  photo: z.string().nullable().optional(),
  landLineNumber: z.string().max(20, "Land line number is too long").nullable().optional(),
  customerType: z.enum(["B2B", "B2C"], {
    required_error: "Please select a customer type",
  }),
});

type FormData = z.infer<typeof customerProfileSchema>;

interface CustomerProfile {
  id: number;
  mobileNumber: string;
  companyName?: string | null;
  contactPerson: string;
  email: string;
  address: string;
  photo?: string;
  landLineNumber?: string | null;
  customerType: 'B2B' | 'B2C';
}

interface EditCustomerProfileDialogProps {
  profile: CustomerProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditCustomerProfileDialog({ profile, open, onOpenChange }: EditCustomerProfileDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<FormData>({
    resolver: zodResolver(customerProfileSchema),
    defaultValues: {
      // A profile created before the separators were stripped holds `+84-930-123-456`;
      // normalising here means such a row opens in a state the validator accepts.
      mobileNumber: normalizePhoneNumber(profile.mobileNumber),
      companyName: profile.companyName ?? "",
      contactPerson: profile.contactPerson,
      email: profile.email,
      address: profile.address,
      photo: profile.photo,
      landLineNumber: normalizePhoneNumber(profile.landLineNumber),
      customerType: profile.customerType,
    },
  });

  const updateCustomerProfile = useMutation({
    mutationFn: async (data: FormData) => {
      const response = await fetch(`/api/customer-profiles/${profile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...data,
          photo: data.photo || null,
          landLineNumber: data.landLineNumber || null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        if (errorData.errors) {
          throw new Error(
            errorData.errors.map((err: any) => `${err.field}: ${err.message}`).join('\n')
          );
        }
        throw new Error(errorData.message || 'Failed to update customer profile');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/customer-profiles'] });
      toast({
        title: "Success",
        description: "Customer profile updated successfully",
        variant: "success",
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    updateCustomerProfile.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The form is taller than a short window, so cap the height and scroll: a dialog that
          is only vertically centred pushes its own header off-screen. */}
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Customer Profile</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Two columns above `sm`, so the whole account fits without scrolling. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="mobileNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mobile Number</FormLabel>
                    <FormControl>
                      {/* Separators are stripped as you type, so a pasted `+84-930-123-456`
                          becomes `+84930123456` and passes the format check. */}
                      <Input
                        {...field}
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="+84930123456"
                        onChange={(event) => field.onChange(normalizePhoneNumber(event.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="companyName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company Name (Optional)</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} placeholder="Acme Pet Supplies Co." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="contactPerson"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Person</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Nguyen Van A" autoComplete="name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="landLineNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Land Line Number (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        {...field}
                        value={field.value ?? ""}
                        inputMode="tel"
                        placeholder="+8428123456"
                        onChange={(event) => field.onChange(normalizePhoneNumber(event.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="customerType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Customer Type</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select customer type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="B2B">B2B - Business</SelectItem>
                        <SelectItem value="B2C">B2C - Consumer</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="photo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Photo URL (Optional)</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} placeholder="https://..." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Addresses are the one long value here. */}
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button variant="update"
                type="submit"
                disabled={updateCustomerProfile.isPending}
              >
                {updateCustomerProfile.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Update Customer Profile
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
