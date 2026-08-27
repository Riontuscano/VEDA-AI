import { UploadForm } from "@/components/UploadForm";

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Answer sheet mapper
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Upload a question paper and a handwritten answer sheet. Every question
        is extracted in printed order, every answer is read and matched to the
        question it answers, and selecting a question highlights that answer on
        the sheet.
      </p>

      <div className="mt-8">
        <UploadForm />
      </div>

      <p className="mt-8 text-xs text-slate-500">
        Pages are rendered in your browser before upload. Nothing is stored
        permanently — sessions are held in memory and expire after an hour.
      </p>
    </main>
  );
}
