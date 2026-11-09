import { useState } from "react";
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
  DialogTrigger,
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
import { Loader2, Plus } from "lucide-react";
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

export function CreateCustomerProfileDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<FormData>({
    resolver: zodResolver(customerProfileSchema),
    defaultValues: {
      mobileNumber: "",
      companyName: "",
      contactPerson: "",
      email: "",
      address: "",
      customerType: undefined,
    },
  });

  // Only a business trades under a company name, so the box is rendered for B2B alone.
  const isBusiness = form.watch("customerType") === "B2B";

  const createCustomerProfile = useMutation({
    mutationFn: async (data: FormData) => {
      const response = await fetch('/api/customer-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        if (errorData.errors) {
          throw new Error(
            errorData.errors.map((err: any) => `${err.field}: ${err.message}`).join('\n')
          );
        }
        throw new Error(errorData.message || 'Failed to create customer profile');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/customer-profiles'] });
      toast({
        title: "Success",
        description: "Customer profile created successfully",
        variant: "success",
      });
      setOpen(false);
      form.reset();
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
    createCustomerProfile.mutate({
      ...data,
      // A consumer has no company - never send one the form is not showing.
      companyName: data.customerType === "B2B" ? data.companyName || null : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="create">
          <Plus className="mr-2 h-4 w-4" />
          Add Customer Profile
        </Button>
      </DialogTrigger>
      {/* Same layout as the edit dialog: capped height that scrolls, two field columns. */}
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Customer Profile</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Asked first: the answer decides whether a company name is collected at all. */}
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

              {isBusiness && (
                <FormField
                  control={form.control}
                  name="companyName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company Name (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          placeholder="Acme Pet Supplies Co."
                          autoComplete="organization"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

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
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button variant="create"
                type="submit"
                disabled={createCustomerProfile.isPending}
              >
                {createCustomerProfile.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Create Customer Profile
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
