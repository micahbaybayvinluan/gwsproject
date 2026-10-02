-- AlterTable
ALTER TABLE "members" ADD COLUMN     "best_time" TEXT,
ADD COLUMN     "budget" TEXT,
ADD COLUMN     "dietary" TEXT,
ADD COLUMN     "flavor_dislikes" TEXT,
ADD COLUMN     "flavor_likes" TEXT,
ADD COLUMN     "goal" TEXT,
ADD COLUMN     "gym" TEXT,
ADD COLUMN     "heard_from" TEXT,
ADD COLUMN     "messenger_handle" TEXT,
ADD COLUMN     "outlet_id" TEXT,
ADD COLUMN     "preferred_channel" TEXT,
ADD COLUMN     "referral_rewarded_at" TIMESTAMP(3),
ADD COLUMN     "referred_by_id" TEXT,
ADD COLUMN     "training_days" TEXT;

